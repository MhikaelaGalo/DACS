import {
  cancelOverdueUnpaidOrders,
  PAYMENT_PROOF_DEADLINE_DAYS,
} from "./order.service";

/*
 * Server-side enforcement of the 14-day payment deadline. The lazy
 * on-read sweep only fires when somebody loads orders; this scheduler
 * makes the countdown real backend behavior — an unpaid order is
 * cancelled (and staff notified) on time even if nobody opens the
 * website or the admin portal for days.
 *
 * The sweep is idempotent and every cancellation re-checks its order in
 * its own transaction, so overlapping runs (scheduler tick + a
 * concurrent order read) are safe.
 */

const DEFAULT_INTERVAL_MINUTES = 60;

// Give the process a moment to finish booting before the first sweep.
const STARTUP_DELAY_MS = 5_000;

function intervalMs(): number {
  const configured = Number(process.env.ORDER_AUTO_CANCEL_INTERVAL_MINUTES);

  const minutes =
    Number.isFinite(configured) && configured >= 1
      ? configured
      : DEFAULT_INTERVAL_MINUTES;

  return minutes * 60 * 1000;
}

async function runSweep(): Promise<void> {
  try {
    const cancelled = await cancelOverdueUnpaidOrders();

    if (cancelled > 0) {
      console.log(
        `[payment-deadline] Auto-cancelled ${cancelled} unpaid order(s) past the ${PAYMENT_PROOF_DEADLINE_DAYS}-day payment deadline.`
      );
    }
  } catch (error) {
    // The scheduler must never take the server down; the next tick (or
    // any order read) retries naturally.
    console.error("[payment-deadline] Sweep failed:", error);
  }
}

export function startPaymentDeadlineScheduler(): () => void {
  const interval = intervalMs();

  const startupTimer = setTimeout(() => void runSweep(), STARTUP_DELAY_MS);
  const tickTimer = setInterval(() => void runSweep(), interval);

  // Timers must not keep a stopping process alive.
  startupTimer.unref();
  tickTimer.unref();

  console.log(
    `[payment-deadline] Scheduler started (every ${Math.round(interval / 60000)} min).`
  );

  return () => {
    clearTimeout(startupTimer);
    clearInterval(tickTimer);
  };
}
