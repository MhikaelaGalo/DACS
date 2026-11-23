import { createTransport } from "nodemailer";
import { prisma } from "../../config/database";

const POLL_MS = 5_000;
const LEASE_MS = 60_000;
// Avoid sending stale payment instructions after a prolonged outage.
const MAX_AGE_MS = 23 * 60 * 60 * 1_000;

function gmailCredentials() {
  const user = process.env.ORDER_EMAIL_FROM?.trim();
  // Google displays app passwords in groups separated by spaces.
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
  if (user && pass) return { user, pass };
}

export function orderEmailSender(): string | undefined {
  const auth = gmailCredentials();
  if (auth) return `Dominant Asia Poultry Genetics <${auth.user}>`;
}

function gmailTransport(auth: { user: string; pass: string }) {
  return createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

export async function deliverDueOrderConfirmations(transport: ReturnType<typeof gmailTransport>) {
  // Claim one row at a time. Another server can pick up a claim after a crash.
  const jobs = await prisma.orderConfirmationEmail.findMany({
    where: { nextAttemptAt: { lte: new Date() } },
    include: { order: { select: { status: true } } },
    orderBy: { nextAttemptAt: "asc" },
    take: 10,
  });
  for (const job of jobs) {
    const claim = await prisma.orderConfirmationEmail.updateMany({
      where: { orderId: job.orderId, attempts: job.attempts, nextAttemptAt: job.nextAttemptAt },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + LEASE_MS) },
    });
    if (!claim.count) continue;

    const where = { orderId: job.orderId, attempts: job.attempts + 1 };
    // A delayed payment request would mislead a buyer whose order is now closed or paid.
    if (job.order.status !== "PENDING" && job.order.status !== "APPROVED") {
      await prisma.orderConfirmationEmail.deleteMany({ where });
      continue;
    }
    if (Date.now() - job.createdAt.getTime() >= MAX_AGE_MS) {
      await prisma.orderConfirmationEmail.updateMany({
        where, data: { nextAttemptAt: null, lastError: "Delivery window expired; review before resending." },
      });
      console.error(`[order-email] Delivery window expired for order ${job.orderId}.`);
      continue;
    }
    try {
      await transport.sendMail({
        from: job.sender,
        to: { name: "", address: job.recipient },
        subject: job.subject,
        text: job.text,
        html: job.html,
        date: job.createdAt,
        messageId: `<dacs-order-${job.orderId}@gmail.com>`,
      });
    } catch (error) {
      const delay = Math.min(60, 2 ** job.attempts) * 60_000;
      // Provider responses may contain account or recipient details. Record the code only.
      const smtpError = error as { code?: string; responseCode?: number } | null;
      const reason = [smtpError?.code ?? "SMTP failure", smtpError?.responseCode].filter(Boolean).join(" ");
      await prisma.orderConfirmationEmail.updateMany({
        where, data: { nextAttemptAt: new Date(Date.now() + delay), lastError: reason },
      });
      console.error(`[order-email] Retrying order ${job.orderId}: ${reason}`);
      continue;
    }
    await prisma.orderConfirmationEmail.deleteMany({ where });
  }
}

export function startOrderConfirmationSender(): () => void {
  // The test server must never deliver mail to real inboxes.
  if (process.env.DACS_TEST_MODE === "1") return () => {};
  const auth = gmailCredentials();
  if (!auth) {
    console.info("[order-email] Set ORDER_EMAIL_FROM and GMAIL_APP_PASSWORD to enable checkout emails.");
    return () => {};
  }
  const transport = gmailTransport(auth);
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await deliverDueOrderConfirmations(transport);
    } catch (error) {
      console.error("[order-email] Could not process the email queue:", error);
    } finally {
      running = false;
    }
  }, POLL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
