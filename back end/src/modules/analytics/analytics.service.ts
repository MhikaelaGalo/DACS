import { Prisma } from "../../../generated/prisma/client";
import type { OrderType } from "../../../generated/prisma/client";

import { prisma } from "../../config/database";

/*
 * Requirement 11: every number here is calculated from the live tables
 * at request time — nothing is stored or maintained by hand, so the
 * dashboard can never drift out of sync with the data.
 *
 * Orders count as sales revenue once payment is verified (or later in
 * the lifecycle). PENDING/APPROVED orders are demand, not sales.
 */
const PAID_ORDER_STATUSES = [
  "PAYMENT_VERIFIED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
] as const;

const PAID_STATUS_SQL = Prisma.sql`('PAYMENT_VERIFIED','PROCESSING','SHIPPED','DELIVERED')`;

export interface DateRange {
  from?: Date;
  to?: Date;
}

function dateFilter(range: DateRange) {
  return {
    ...(range.from || range.to
      ? {
          createdAt: {
            ...(range.from ? { gte: range.from } : {}),
            ...(range.to ? { lte: range.to } : {}),
          },
        }
      : {}),
  };
}

/*
 * Raw-SQL fragment for the same range (used by the month-series
 * queries, which need date_trunc — Prisma's groupBy cannot bucket by
 * month). Defaults to the trailing 12 months so the dashboard always
 * has a bounded, index-friendly window.
 */
function rangeBounds(range: DateRange): { from: Date; to: Date } {
  const to = range.to ?? new Date();
  const from =
    range.from ??
    new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1));
  return { from, to };
}

// ---- Customers (Requirement 3 + 10 data) -----------------------------------

export async function getCustomerAnalytics(range: DateRange) {
  const [
    totalActive,
    archived,
    linkedAccounts,
    unclaimedHistorical,
    newInPeriod,
    totalFarms,
    customersByRegion,
    farmsByRegion,
  ] = await Promise.all([
    prisma.customerProfile.count({ where: { archivedAt: null } }),
    prisma.customerProfile.count({ where: { archivedAt: { not: null } } }),
    prisma.customerProfile.count({
      where: { archivedAt: null, userId: { not: null } },
    }),
    prisma.customerProfile.count({
      where: { archivedAt: null, userId: null },
    }),
    prisma.customerProfile.count({
      where: { archivedAt: null, ...dateFilter(range) },
    }),
    prisma.farm.count({ where: { archivedAt: null } }),
    prisma.customerProfile.groupBy({
      by: ["region"],
      where: { archivedAt: null },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
    }),
    prisma.farm.groupBy({
      by: ["region", "province"],
      where: { archivedAt: null },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
    }),
  ]);

  return {
    totals: {
      activeCustomers: totalActive,
      archivedCustomers: archived,
      withLinkedAccount: linkedAccounts,
      unclaimedHistorical,
      newInPeriod,
      activeFarms: totalFarms,
    },
    customersByRegion: customersByRegion.map((row) => ({
      region: row.region ?? "Unspecified",
      count: row._count._all,
    })),
    farmsByRegion: farmsByRegion.map((row) => ({
      region: row.region ?? "Unspecified",
      province: row.province ?? "Unspecified",
      count: row._count._all,
    })),
  };
}

// ---- Orders (Requirement 4) ------------------------------------------------

export async function getOrderAnalytics(
  range: DateRange,
  orderType?: OrderType
) {
  const where = {
    ...dateFilter(range),
    ...(orderType ? { orderType } : {}),
  };

  const paidWhere = {
    ...where,
    status: { in: [...PAID_ORDER_STATUSES] },
  };

  const { from, to } = rangeBounds(range);

  const [totalOrders, byStatus, byType, paidByType, salesPerMonth] =
    await Promise.all([
      prisma.order.count({ where }),
      prisma.order.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
        orderBy: { _count: { id: "desc" } },
      }),
      prisma.order.groupBy({
        by: ["orderType"],
        where,
        _count: { _all: true },
        _sum: { totalAmount: true },
        orderBy: { _count: { id: "desc" } },
      }),
      prisma.order.groupBy({
        by: ["orderType"],
        where: paidWhere,
        _count: { _all: true },
        _sum: { totalAmount: true },
        orderBy: { _count: { id: "desc" } },
      }),
      prisma.$queryRaw<
        Array<{
          month: string;
          orders: number;
          paidOrders: number;
          revenue: number;
        }>
      >`
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
               COUNT(*)::int AS orders,
               COUNT(*) FILTER (WHERE status::text IN ${PAID_STATUS_SQL})::int
                 AS "paidOrders",
               COALESCE(
                 SUM(total_amount) FILTER (WHERE status::text IN ${PAID_STATUS_SQL}),
                 0
               )::float8 AS revenue
        FROM orders
        WHERE created_at >= ${from} AND created_at <= ${to}
          ${orderType ? Prisma.sql`AND order_type::text = ${orderType}` : Prisma.empty}
        GROUP BY 1
        ORDER BY 1
      `,
    ]);

  return {
    totals: {
      orders: totalOrders,
      paidOrders: paidByType.reduce((sum, row) => sum + row._count._all, 0),
      paidRevenue: paidByType.reduce(
        (sum, row) => sum + Number(row._sum.totalAmount ?? 0),
        0
      ),
    },
    byStatus: byStatus.map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
    byType: byType.map((row) => ({
      orderType: row.orderType,
      orders: row._count._all,
      orderedAmount: Number(row._sum.totalAmount ?? 0),
    })),
    salesByType: paidByType.map((row) => ({
      orderType: row.orderType,
      sales: row._count._all,
      revenue: Number(row._sum.totalAmount ?? 0),
    })),
    salesPerMonth,
  };
}

// ---- Payments (Requirement 5) ----------------------------------------------

export async function getPaymentAnalytics(range: DateRange) {
  const where = dateFilter(range);
  const { from, to } = rangeBounds(range);

  const [byStatus, byMonth] = await Promise.all([
    prisma.payment.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
      _sum: { amount: true },
      orderBy: { _count: { id: "desc" } },
    }),
    prisma.$queryRaw<
      Array<{ month: string; payments: number; verifiedAmount: number }>
    >`
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
             COUNT(*)::int AS payments,
             COALESCE(
               SUM(amount) FILTER (WHERE status::text = 'VERIFIED'),
               0
             )::float8 AS "verifiedAmount"
      FROM payments
      WHERE created_at >= ${from} AND created_at <= ${to}
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  return {
    byStatus: byStatus.map((row) => ({
      status: row.status,
      count: row._count._all,
      amount: Number(row._sum.amount ?? 0),
    })),
    perMonth: byMonth,
  };
}

// ---- Seminars (Requirement 6) ----------------------------------------------

export async function getSeminarAnalytics() {
  const [modules, enrollmentByModule, completedByModule, quizStats, certificates] =
    await Promise.all([
      prisma.seminarModule.findMany({
        select: { id: true, moduleNumber: true, title: true, isPublished: true },
        orderBy: { moduleNumber: "asc" },
      }),
      prisma.seminarEnrollment.groupBy({
        by: ["moduleId"],
        _count: { _all: true },
      }),
      prisma.seminarEnrollment.groupBy({
        by: ["moduleId"],
        where: { completedAt: { not: null } },
        _count: { _all: true },
      }),
      prisma.quizAttempt.groupBy({
        by: ["passed"],
        _count: { _all: true },
      }),
      prisma.certificateRequest.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
    ]);

  const enrollmentMap = new Map(
    enrollmentByModule.map((row) => [row.moduleId, row._count._all])
  );
  const completedMap = new Map(
    completedByModule.map((row) => [row.moduleId, row._count._all])
  );

  const byModule = modules.map((module) => {
    const enrolled = enrollmentMap.get(module.id) ?? 0;
    const completed = completedMap.get(module.id) ?? 0;

    return {
      moduleNumber: module.moduleNumber,
      title: module.title,
      isPublished: module.isPublished,
      enrolled,
      completed,
      completionRate: enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0,
    };
  });

  const totalAttempts = quizStats.reduce((sum, row) => sum + row._count._all, 0);
  const passedAttempts =
    quizStats.find((row) => row.passed)?._count._all ?? 0;

  return {
    byModule,
    quiz: {
      attempts: totalAttempts,
      passed: passedAttempts,
      passRate:
        totalAttempts > 0
          ? Math.round((passedAttempts / totalAttempts) * 100)
          : 0,
    },
    certificates: certificates.map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
  };
}

// ---- Breeders (Requirement 7) ----------------------------------------------

/*
 * The overall status per breeder record follows the registry rule
 * (INELIGIBLE > ACTIVE cert > EXPIRED cert > PENDING) and is
 * date-aware in SQL: a certificate only counts as active while
 * expires_at is in the future, so the analytics never lag behind the
 * on-read status refresh.
 */
const BREEDER_STATUS_CASE = Prisma.sql`
  CASE
    WHEN be.status::text = 'INELIGIBLE' THEN 'INELIGIBLE'
    WHEN ac.active_count > 0 THEN 'ACTIVE'
    WHEN ac.total_certs > 0 THEN 'EXPIRED'
    ELSE 'PENDING'
  END
`;

const BREEDER_FROM_SQL = Prisma.sql`
  FROM breeder_monitoring bm
  JOIN farms f ON f.id = bm.farm_id
  JOIN breeder_eligibility be ON be.monitoring_id = bm.id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (
        WHERE c.status::text = 'ACTIVE' AND c.expires_at > NOW()
      )::int AS active_count,
      COUNT(*)::int AS total_certs
    FROM breeder_certifications c
    WHERE c.monitoring_id = bm.id
  ) ac ON TRUE
`;

export async function getBreederAnalytics(filters: {
  region?: string;
  province?: string;
}) {
  const regionFilter = filters.region
    ? Prisma.sql`AND LOWER(f.region) = LOWER(${filters.region})`
    : Prisma.empty;
  const provinceFilter = filters.province
    ? Prisma.sql`AND LOWER(f.province) = LOWER(${filters.province})`
    : Prisma.empty;

  const [statusDistribution, byRegion, renewalsDue] = await Promise.all([
    prisma.$queryRaw<Array<{ status: string; count: number }>>`
      SELECT ${BREEDER_STATUS_CASE} AS status, COUNT(*)::int AS count
      ${BREEDER_FROM_SQL}
      WHERE TRUE ${regionFilter} ${provinceFilter}
      GROUP BY 1
      ORDER BY 2 DESC
    `,
    prisma.$queryRaw<
      Array<{
        region: string;
        province: string;
        total: number;
        active: number;
        pending: number;
        expired: number;
        ineligible: number;
      }>
    >`
      SELECT COALESCE(f.region, 'Unspecified') AS region,
             COALESCE(f.province, 'Unspecified') AS province,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE ${BREEDER_STATUS_CASE} = 'ACTIVE')::int AS active,
             COUNT(*) FILTER (WHERE ${BREEDER_STATUS_CASE} = 'PENDING')::int AS pending,
             COUNT(*) FILTER (WHERE ${BREEDER_STATUS_CASE} = 'EXPIRED')::int AS expired,
             COUNT(*) FILTER (WHERE ${BREEDER_STATUS_CASE} = 'INELIGIBLE')::int AS ineligible
      ${BREEDER_FROM_SQL}
      WHERE TRUE ${regionFilter} ${provinceFilter}
      GROUP BY 1, 2
      ORDER BY total DESC
    `,
    // Renewal pipeline: active certificates expiring within 90 days.
    prisma.breederCertification.count({
      where: {
        status: "ACTIVE",
        expiresAt: {
          gt: new Date(),
          lte: new Date(Date.now() + 90 * 86_400_000),
        },
      },
    }),
  ]);

  return {
    statusDistribution,
    byRegion,
    renewalsDueWithin90Days: renewalsDue,
  };
}

// ---- Inquiry tickets (Requirement 8) ---------------------------------------

export async function getInquiryAnalytics(
  range: DateRange,
  category?: string
) {
  const where = {
    ...dateFilter(range),
    ...(category
      ? { category: { equals: category, mode: "insensitive" as const } }
      : {}),
  };

  const { from, to } = rangeBounds(range);

  const [byStatus, byCategory, perMonth, responseStats] = await Promise.all([
    prisma.inquiryTicket.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
    }),
    prisma.inquiryTicket.groupBy({
      by: ["category"],
      where,
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
    }),
    prisma.$queryRaw<Array<{ month: string; tickets: number }>>`
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
             COUNT(*)::int AS tickets
      FROM inquiry_tickets
      WHERE created_at >= ${from} AND created_at <= ${to}
        ${category ? Prisma.sql`AND LOWER(category) = LOWER(${category})` : Prisma.empty}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<Array<{ avgResponseHours: number | null }>>`
      SELECT AVG(
               EXTRACT(EPOCH FROM (email_responded_at - created_at)) / 3600
             )::float8 AS "avgResponseHours"
      FROM inquiry_tickets
      WHERE email_responded_at IS NOT NULL
        AND created_at >= ${from} AND created_at <= ${to}
    `,
  ]);

  return {
    byStatus: byStatus.map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
    byCategory: byCategory.map((row) => ({
      category: row.category ?? "Uncategorized",
      count: row._count._all,
    })),
    perMonth,
    averageResponseHours: responseStats[0]?.avgResponseHours ?? null,
  };
}

// ---- Combined dashboard ----------------------------------------------------

/*
 * One request feeds the whole dashboard page: KPI cards plus every
 * chart series, all computed in parallel.
 */
export async function getDashboardSummary(range: DateRange) {
  const [customers, orders, payments, seminars, breeders, inquiries] =
    await Promise.all([
      getCustomerAnalytics(range),
      getOrderAnalytics(range),
      getPaymentAnalytics(range),
      getSeminarAnalytics(),
      getBreederAnalytics({}),
      getInquiryAnalytics(range),
    ]);

  const activeBreeders =
    breeders.statusDistribution.find((row) => row.status === "ACTIVE")?.count ??
    0;

  const openTickets = inquiries.byStatus
    .filter((row) => row.status === "SUBMITTED" || row.status === "UNDER_REVIEW")
    .reduce((sum, row) => sum + row.count, 0);

  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      totalCustomers: customers.totals.activeCustomers,
      totalFarms: customers.totals.activeFarms,
      totalOrders: orders.totals.orders,
      paidRevenue: orders.totals.paidRevenue,
      salesByType: orders.salesByType,
      activeBreeders,
      openTickets,
      seminarCertificatesIssued:
        seminars.certificates.find((row) => row.status === "APPROVED")?.count ??
        0,
    },
    charts: {
      salesPerMonth: orders.salesPerMonth,
      ordersByStatus: orders.byStatus,
      ordersByType: orders.byType,
      paymentStatus: payments.byStatus,
      seminarByModule: seminars.byModule,
      breederStatus: breeders.statusDistribution,
      breedersByRegion: breeders.byRegion,
      customersByRegion: customers.customersByRegion,
      inquiryStatus: inquiries.byStatus,
      inquiriesPerMonth: inquiries.perMonth,
    },
  };
}

// ---- Exportable report data (CSV) ------------------------------------------

export const EXPORT_REPORTS = [
  "orders",
  "customers",
  "payments",
  "seminars",
  "breeders",
  "inquiries",
] as const;

export type ExportReport = (typeof EXPORT_REPORTS)[number];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text =
    value instanceof Date ? value.toISOString() : String(value);

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(",")];

  for (const row of rows) {
    lines.push(row.map(csvCell).join(","));
  }

  return `${lines.join("\r\n")}\r\n`;
}

const EXPORT_ROW_LIMIT = 20_000;

export async function buildExportCsv(
  report: ExportReport,
  range: DateRange
): Promise<string> {
  const where = dateFilter(range);

  switch (report) {
    case "orders": {
      const rows = await prisma.order.findMany({
        where,
        take: EXPORT_ROW_LIMIT,
        orderBy: { createdAt: "asc" },
        include: {
          customerProfile: {
            select: { customerNumber: true, firstName: true, lastName: true },
          },
        },
      });

      return toCsv(
        [
          "orderNumber",
          "customerNumber",
          "customerName",
          "orderType",
          "status",
          "createdAt",
          "dateNeeded",
          "subtotal",
          "feeTotal",
          "totalAmount",
          "depositPercent",
          "depositDueDate",
          "balanceDueDate",
          "releasedAt",
        ],
        rows.map((order) => [
          order.orderNumber,
          order.customerProfile.customerNumber,
          `${order.customerProfile.firstName} ${order.customerProfile.lastName}`,
          order.orderType,
          order.status,
          order.createdAt,
          order.dateNeeded,
          order.subtotal.toString(),
          order.feeTotal.toString(),
          order.totalAmount.toString(),
          order.depositPercent,
          order.depositDueDate,
          order.balanceDueDate,
          order.releasedAt,
        ])
      );
    }

    case "customers": {
      const rows = await prisma.customerProfile.findMany({
        where: { archivedAt: null, ...where },
        take: EXPORT_ROW_LIMIT,
        orderBy: { customerNumber: "asc" },
      });

      return toCsv(
        [
          "customerNumber",
          "firstName",
          "middleName",
          "lastName",
          "suffix",
          "contactEmail",
          "phoneNumber",
          "region",
          "province",
          "cityMunicipality",
          "hasLinkedAccount",
          "createdAt",
        ],
        rows.map((profile) => [
          profile.customerNumber,
          profile.firstName,
          profile.middleName,
          profile.lastName,
          profile.suffix,
          profile.contactEmail,
          profile.phoneNumber,
          profile.region,
          profile.province,
          profile.cityMunicipality,
          profile.userId ? "yes" : "no",
          profile.createdAt,
        ])
      );
    }

    case "payments": {
      const rows = await prisma.payment.findMany({
        where,
        take: EXPORT_ROW_LIMIT,
        orderBy: { createdAt: "asc" },
        include: {
          order: { select: { orderNumber: true } },
          customerProfile: { select: { customerNumber: true } },
        },
      });

      return toCsv(
        [
          "orderNumber",
          "customerNumber",
          "paymentType",
          "amount",
          "status",
          "paymentDate",
          "referenceNumber",
          "verifiedAt",
          "createdAt",
        ],
        rows.map((payment) => [
          payment.order.orderNumber,
          payment.customerProfile.customerNumber,
          payment.paymentType,
          payment.amount.toString(),
          payment.status,
          payment.paymentDate,
          payment.referenceNumber,
          payment.verifiedAt,
          payment.createdAt,
        ])
      );
    }

    case "seminars": {
      const rows = await prisma.seminarEnrollment.findMany({
        take: EXPORT_ROW_LIMIT,
        orderBy: { startedAt: "asc" },
        include: {
          customerProfile: { select: { customerNumber: true } },
          module: { select: { moduleNumber: true, title: true } },
        },
      });

      return toCsv(
        [
          "customerNumber",
          "moduleNumber",
          "moduleTitle",
          "startedAt",
          "completedAt",
          "isCompleted",
        ],
        rows.map((enrollment) => [
          enrollment.customerProfile.customerNumber,
          enrollment.module.moduleNumber,
          enrollment.module.title,
          enrollment.startedAt,
          enrollment.completedAt,
          enrollment.completedAt ? "yes" : "no",
        ])
      );
    }

    case "breeders": {
      const rows = await prisma.breederMonitoring.findMany({
        take: EXPORT_ROW_LIMIT,
        orderBy: { releasedAt: "asc" },
        include: {
          customerProfile: { select: { customerNumber: true } },
          farm: {
            select: { farmName: true, region: true, province: true },
          },
          eligibility: { select: { status: true } },
          certifications: {
            orderBy: { certifiedAt: "desc" },
            take: 1,
          },
        },
      });

      return toCsv(
        [
          "customerNumber",
          "farmName",
          "region",
          "province",
          "releasedAt",
          "eligibleAt",
          "eligibilityStatus",
          "latestCertificateNumber",
          "latestCertificateStatus",
          "latestCertificateExpiresAt",
        ],
        rows.map((monitoring) => {
          const certificate = monitoring.certifications[0] ?? null;

          return [
            monitoring.customerProfile.customerNumber,
            monitoring.farm.farmName,
            monitoring.farm.region,
            monitoring.farm.province,
            monitoring.releasedAt,
            monitoring.eligibleAt,
            monitoring.eligibility?.status ?? "PENDING",
            certificate?.certificateNumber,
            certificate?.status,
            certificate?.expiresAt,
          ];
        })
      );
    }

    case "inquiries": {
      const rows = await prisma.inquiryTicket.findMany({
        where,
        take: EXPORT_ROW_LIMIT,
        orderBy: { createdAt: "asc" },
        include: {
          customerProfile: { select: { customerNumber: true } },
        },
      });

      return toCsv(
        [
          "ticketNumber",
          "customerNumber",
          "subject",
          "category",
          "priority",
          "status",
          "createdAt",
          "emailRespondedAt",
          "closedAt",
        ],
        rows.map((ticket) => [
          ticket.ticketNumber,
          ticket.customerProfile.customerNumber,
          ticket.subject,
          ticket.category,
          ticket.priority,
          ticket.status,
          ticket.createdAt,
          ticket.emailRespondedAt,
          ticket.closedAt,
        ])
      );
    }
  }
}
