import "./test-env";
import { prisma } from "../../src/config/database";

// This account holds only the integration suites' dashboard. Staff fixtures
// sign in under different accounts so personal-layout regressions are visible.
export async function getDashboardFixtureAccount() {
  const email = "dashboard-layout@dacs-test.example";
  return prisma.user.upsert({
    where: { email },
    create: { email, role: "OWNER_EXECUTIVE" },
    update: {},
    select: { id: true },
  });
}
