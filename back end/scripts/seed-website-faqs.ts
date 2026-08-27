/*
 * Seeds the customer website's four client-approved FAQ items as
 * published FAQs (idempotent — upserts by exact question text) and
 * removes the terse suite-fixture FAQ that duplicates the first topic.
 *
 * Run with the backend env:  npx tsx scripts/seed-website-faqs.ts
 * Re-run after test-suite runs (section 10i clears the faqs table).
 */
import { prisma } from "../src/config/database";

/*
 * The proof-of-payment inbox. Keep in sync with PAYMENT_PROOF_EMAIL in
 * front end/dacs-website/src/components/orders/PaymentDeadlineNotice.tsx —
 * when the real DACS mailbox exists, change both and re-run this script
 * so the live FAQ row matches the site.
 */
const PAYMENT_PROOF_EMAIL = "dacs@gmail.com";

const APPROVED_FAQS = [
  {
    question: "What do I need to complete before I can order Parent Stock?",
    answer:
      "Farmers must successfully complete Seminar Modules 1, 2, and 3 before Parent Stock ordering becomes available through DACS. Seminar enrollment, progress, assessments, and module completion are recorded in the farmer's account for verification.",
    category: "Ordering",
  },
  {
    question: "How do I submit my payment and know when it has been verified?",
    answer: `After placing an order, email your proof of payment to ${PAYMENT_PROOF_EMAIL} within 14 days of checkout. Authorized Administrative Staff will review the emailed proof and update the corresponding payment and order status — orders with no recorded payment within 14 days are cancelled automatically. You can monitor these updates and view your transaction history through your account.`,
    category: "Payments",
  },
  {
    question: "How can I check my breeder eligibility and certification status?",
    answer:
      "Your DACS account allows you to view your breeder eligibility and certification status. Breeder eligibility is monitored using the released date of the applicable Parent Stock transaction and follows a ninety-day eligibility period. Breeder certifications are valid for two years, with statuses including Active, Pending, Expired, and Ineligible.",
    category: "Breeder Certification",
  },
  {
    question: "How can I submit a question or follow up on an inquiry?",
    answer:
      "You can submit an inquiry through DACS and receive a reference number for tracking. Inquiry tickets may be marked as Submitted, Under Review, Responded, or Closed. Responses and resolutions are sent through the organization's official email, while the ticket and its status remain available in DACS.",
    category: "Support",
  },
];

async function main(): Promise<void> {
  // The suite fixture FAQ covers the same ground as the first approved
  // item — remove only that exact row.
  const removed = await prisma.faq.deleteMany({
    where: {
      question: "How do I order Parent Stock?",
      answer: "Complete Seminar Modules 1-3, then order from the catalog.",
    },
  });
  if (removed.count > 0) {
    console.log(`Removed ${removed.count} suite-fixture FAQ row(s).`);
  }

  for (const [index, faq] of APPROVED_FAQS.entries()) {
    const existing = await prisma.faq.findFirst({
      where: { question: faq.question },
    });
    if (existing) {
      await prisma.faq.update({
        where: { id: existing.id },
        data: {
          answer: faq.answer,
          category: faq.category,
          isPublished: true,
          displayOrder: index + 1,
        },
      });
      console.log(`Updated: ${faq.question}`);
    } else {
      await prisma.faq.create({
        data: {
          question: faq.question,
          answer: faq.answer,
          category: faq.category,
          isPublished: true,
          displayOrder: index + 1,
        },
      });
      console.log(`Created: ${faq.question}`);
    }
  }

  const published = await prisma.faq.count({ where: { isPublished: true } });
  console.log(`Published FAQs now: ${published}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
