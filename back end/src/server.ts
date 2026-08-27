import "dotenv/config";

import { app } from "./app";
import { prisma } from "./config/database";
import { startPaymentDeadlineScheduler } from "./modules/orders/order.scheduler";

const port = Number(process.env.PORT) || 5000;

const server = app.listen(port, () => {
  console.log(`DACS backend is running at http://localhost:${port}`);
});

// Backend-owned countdown: unpaid orders are cancelled on schedule even
// when no request ever triggers the lazy on-read sweep.
const stopPaymentDeadlineScheduler = startPaymentDeadlineScheduler();

async function shutdown(): Promise<void> {
  console.log("Shutting down DACS backend...");
  stopPaymentDeadlineScheduler();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
