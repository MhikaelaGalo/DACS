import { Prisma } from "../../../generated/prisma/client";
import type {
  BreederCertificationStatus,
  BreederEligibilityStatus,
} from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import { recordActivity } from "../../services/activityLog.service";
import { notifyUser } from "../notifications/notification.service";
import { HttpError } from "../../utils/httpError";
import type { RequestMeta } from "../auth/auth.service";

/*
 * Advisory-lock key for BRD-YYYY-XXXXXX certificate numbers
 * (43010001 DAPG, 43010002 ORD, 43010003 SEM).
 */
const BREEDER_CERTIFICATE_LOCK_KEY = 43010007;

const ELIGIBILITY_WAITING_DAYS = 90;
const CERTIFICATION_VALIDITY_YEARS = 2;

/*
 * numberAlive and breedersClaimed are free text, matching how staff
 * actually record them: breed line + sex split ("D853 - 30f + 6m").
 */
export interface UpdateMonitoringInput {
  breederDate?: Date | null;
  numberAlive?: string | null;
  vaccinationRecords?: string | null;
  feedingManagement?: string | null;
  healthManagement?: string | null;
  weightManagement?: string | null;
  breedersClaimed?: string | null;
}

// releasedAt + 90 days: the paper's eligibility rule.
function calculateEligibilityDate(releasedAt: Date): Date {
  const eligibleAt = new Date(releasedAt);
  eligibleAt.setUTCDate(eligibleAt.getUTCDate() + ELIGIBILITY_WAITING_DAYS);
  return eligibleAt;
}

// certifiedAt + 2 calendar years: the paper's validity rule.
function calculateCertificationExpiration(certifiedAt: Date): Date {
  const expiresAt = new Date(certifiedAt);
  expiresAt.setUTCFullYear(
    expiresAt.getUTCFullYear() + CERTIFICATION_VALIDITY_YEARS
  );
  return expiresAt;
}

/*
 * Overall breeder status per the paper's four states. Eligibility and
 * certification are two different questions; this combines them:
 *   failed eligibility            -> INELIGIBLE
 *   valid certificate             -> ACTIVE
 *   certificate lapsed            -> EXPIRED
 *   everything else (waiting/...) -> PENDING
 */
function calculateOverallBreederStatus(
  eligibilityStatus: BreederEligibilityStatus,
  certificationStatus: BreederCertificationStatus | null
): "ACTIVE" | "PENDING" | "EXPIRED" | "INELIGIBLE" {
  if (eligibilityStatus === "INELIGIBLE") return "INELIGIBLE";
  if (certificationStatus === "ACTIVE") return "ACTIVE";
  if (certificationStatus === "EXPIRED") return "EXPIRED";
  return "PENDING";
}

/*
 * Date-driven automation: once the 90-day mark passes, PENDING becomes
 * ELIGIBLE on its own. A manual INELIGIBLE decision is never overridden.
 */
async function refreshEligibility(
  transaction: Prisma.TransactionClient,
  monitoringId: string
): Promise<void> {
  const eligibility = await transaction.breederEligibility.findUnique({
    where: { monitoringId },
  });

  if (!eligibility || eligibility.status !== "PENDING") return;

  if (new Date() >= eligibility.eligibleAt) {
    await transaction.breederEligibility.update({
      where: { id: eligibility.id },
      data: { status: "ELIGIBLE" },
    });
  }
}

/*
 * Date-driven automation: an ACTIVE certification whose expiry has
 * passed becomes EXPIRED. The frontend never decides this.
 */
async function refreshCertificationStatuses(
  transaction: Prisma.TransactionClient,
  monitoringId: string
): Promise<void> {
  /*
   * Expired certificates are fetched before flipping so the expiry
   * notification fires exactly once — on the read that performs the
   * ACTIVE -> EXPIRED transition.
   */
  const expiring = await transaction.breederCertification.findMany({
    where: {
      monitoringId,
      status: "ACTIVE",
      expiresAt: { lte: new Date() },
    },
    select: {
      id: true,
      certificateNumber: true,
      expiresAt: true,
      monitoring: {
        select: {
          customerProfile: { select: { userId: true } },
        },
      },
    },
  });

  if (expiring.length === 0) {
    return;
  }

  await transaction.breederCertification.updateMany({
    where: { id: { in: expiring.map((certification) => certification.id) } },
    data: { status: "EXPIRED" },
  });

  for (const certification of expiring) {
    const ownerUserId = certification.monitoring.customerProfile.userId;

    if (ownerUserId) {
      await notifyUser(transaction, ownerUserId, {
        type: "CERTIFICATE_EXPIRED",
        title: "Breeder certificate expired",
        message: `Your breeder certificate ${certification.certificateNumber} expired on ${certification.expiresAt.toISOString().slice(0, 10)}. Please renew it.`,
        recordType: "BreederCertification",
        recordId: certification.id,
      });
    }
  }
}

const BREEDER_RECORD_INCLUDE = {
  farm: true,
  parentStockOrder: {
    select: {
      id: true,
      orderNumber: true,
      orderType: true,
      status: true,
      releasedAt: true,
    },
  },
  eligibility: true,
  certifications: {
    orderBy: { certifiedAt: "desc" as const },
  },
};

/*
 * The Requirement 7 heart: called by the order service inside the same
 * transaction that marks a Parent Stock order DELIVERED. Idempotent —
 * one release, one monitoring cycle. The record attaches to the
 * customer's primary farm (oldest active farm as fallback).
 */
export async function startBreederMonitoringForReleasedOrder(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  orderId: string,
  releasedAt: Date,
  meta: RequestMeta
) {
  const order = await transaction.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      orderType: true,
      customerProfileId: true,
      breederMonitoring: { select: { id: true } },
    },
  });

  if (!order || order.orderType !== "PARENT_STOCK") return null;
  if (order.breederMonitoring) return order.breederMonitoring;

  const farm = await transaction.farm.findFirst({
    where: {
      customerProfileId: order.customerProfileId,
      archivedAt: null,
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  if (!farm) {
    throw new HttpError(
      409,
      "Parent Stock cannot be released because the customer has no active farm for breeder monitoring."
    );
  }

  const eligibleAt = calculateEligibilityDate(releasedAt);

  const monitoring = await transaction.breederMonitoring.create({
    data: {
      customerProfileId: order.customerProfileId,
      farmId: farm.id,
      parentStockOrderId: order.id,
      releasedAt,
      eligibleAt,
      eligibility: {
        create: {
          eligibleAt,
          status: "PENDING",
        },
      },
    },
  });

  await recordActivity(transaction, {
    userId: actorUserId,
    module: "BREEDERS",
    action: "BREEDER_MONITORING_STARTED",
    description: `Breeder monitoring started for released order ${order.orderNumber}; eligible on ${eligibleAt.toISOString().slice(0, 10)}.`,
    recordType: "BreederMonitoring",
    recordId: monitoring.id,
    metadata: {
      orderNumber: order.orderNumber,
      releasedAt: releasedAt.toISOString(),
      eligibleAt: eligibleAt.toISOString(),
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return monitoring;
}

export async function updateBreederMonitoring(
  actorUserId: string,
  monitoringId: string,
  input: UpdateMonitoringInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.breederMonitoring.findUnique({
      where: { id: monitoringId },
    });

    if (!existing) {
      throw new HttpError(404, "Breeder monitoring record was not found.");
    }

    const data: Prisma.BreederMonitoringUpdateInput = {};
    if (input.breederDate !== undefined) data.breederDate = input.breederDate;
    if (input.numberAlive !== undefined) data.numberAlive = input.numberAlive;
    if (input.vaccinationRecords !== undefined)
      data.vaccinationRecords = input.vaccinationRecords;
    if (input.feedingManagement !== undefined)
      data.feedingManagement = input.feedingManagement;
    if (input.healthManagement !== undefined)
      data.healthManagement = input.healthManagement;
    if (input.weightManagement !== undefined)
      data.weightManagement = input.weightManagement;
    if (input.breedersClaimed !== undefined)
      data.breedersClaimed = input.breedersClaimed;

    if (Object.keys(data).length === 0) {
      throw new HttpError(400, "At least one monitoring field must be supplied.");
    }

    const monitoring = await transaction.breederMonitoring.update({
      where: { id: monitoringId },
      data,
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "BREEDERS",
      action: "BREEDER_MONITORING_UPDATED",
      description: "Breeder monitoring information was updated.",
      recordType: "BreederMonitoring",
      recordId: monitoring.id,
      metadata: { updatedFields: Object.keys(data) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return monitoring;
  });
}

export async function evaluateBreederEligibility(
  actorUserId: string,
  monitoringId: string,
  decision: "ELIGIBLE" | "INELIGIBLE",
  remarks: string | null,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const monitoring = await transaction.breederMonitoring.findUnique({
      where: { id: monitoringId },
      include: { eligibility: true },
    });

    if (!monitoring || !monitoring.eligibility) {
      throw new HttpError(404, "Breeder monitoring record was not found.");
    }

    /*
     * Even staff cannot approve eligibility before the 90-day waiting
     * period ends. INELIGIBLE has no date guard: disqualification can
     * happen at any point.
     */
    if (decision === "ELIGIBLE" && new Date() < monitoring.eligibleAt) {
      throw new HttpError(
        409,
        `The 90-day breeder eligibility period has not been completed. Eligible on ${monitoring.eligibleAt.toISOString().slice(0, 10)}.`
      );
    }

    const eligibility = await transaction.breederEligibility.update({
      where: { id: monitoring.eligibility.id },
      data: {
        status: decision,
        evaluatedByUserId: actorUserId,
        evaluatedAt: new Date(),
        remarks,
      },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "BREEDERS",
      action:
        decision === "ELIGIBLE"
          ? "BREEDER_ELIGIBILITY_APPROVED"
          : "BREEDER_ELIGIBILITY_REJECTED",
      description: `Breeder eligibility was marked ${decision.toLowerCase()}.`,
      recordType: "BreederEligibility",
      recordId: eligibility.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return eligibility;
  });
}

async function generateBreederCertificateNumber(
  transaction: Prisma.TransactionClient
): Promise<string> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${BREEDER_CERTIFICATE_LOCK_KEY})`;

  // Year-scoped, derived from the latest issued number (BRD-2026-000001,
  // BRD-2027-000001, ...) so deletions can never cause duplicates.
  const year = new Date().getFullYear();
  const prefix = `BRD-${year}-`;

  const latest = await transaction.breederCertification.findFirst({
    where: { certificateNumber: { startsWith: prefix } },
    orderBy: { certificateNumber: "desc" },
    select: { certificateNumber: true },
  });

  let nextNumber = 1;

  if (latest?.certificateNumber) {
    const previous = Number(latest.certificateNumber.slice(prefix.length));
    if (Number.isFinite(previous)) {
      nextNumber = previous + 1;
    }
  }

  return `${prefix}${String(nextNumber).padStart(6, "0")}`;
}

export async function issueBreederCertification(
  actorUserId: string,
  monitoringId: string,
  remarks: string | null,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    await refreshEligibility(transaction, monitoringId);
    await refreshCertificationStatuses(transaction, monitoringId);

    const monitoring = await transaction.breederMonitoring.findUnique({
      where: { id: monitoringId },
      include: {
        eligibility: true,
        certifications: {
          where: { status: "ACTIVE" },
          take: 1,
        },
      },
    });

    if (!monitoring || !monitoring.eligibility) {
      throw new HttpError(404, "Breeder monitoring record was not found.");
    }

    if (monitoring.eligibility.status !== "ELIGIBLE") {
      throw new HttpError(
        409,
        "The breeder is not eligible for certification."
      );
    }

    if (monitoring.certifications.length > 0) {
      throw new HttpError(
        409,
        "This breeder already has an active certification."
      );
    }

    /*
     * Both dates are backend-calculated; the two-year validity rule can
     * never be supplied by a request body. Until the client defines an
     * earlier reminder policy, renewal is due at expiry.
     */
    const certifiedAt = new Date();
    const expiresAt = calculateCertificationExpiration(certifiedAt);
    const certificateNumber =
      await generateBreederCertificateNumber(transaction);

    const certification = await transaction.breederCertification.create({
      data: {
        monitoringId: monitoring.id,
        certificateNumber,
        status: "ACTIVE",
        certifiedAt,
        expiresAt,
        renewalDueAt: expiresAt,
        issuedByUserId: actorUserId,
        remarks,
      },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "BREEDERS",
      action: "BREEDER_CERTIFICATE_ISSUED",
      description: `Breeder certificate ${certificateNumber} was issued.`,
      recordType: "BreederCertification",
      recordId: certification.id,
      metadata: {
        certificateNumber,
        certifiedAt: certifiedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const owner = await transaction.customerProfile.findUnique({
      where: { id: monitoring.customerProfileId },
      select: { userId: true },
    });

    if (owner?.userId) {
      await notifyUser(transaction, owner.userId, {
        type: "CERTIFICATE_APPROVED",
        title: "Breeder certificate issued",
        message: `Your breeder certificate ${certificateNumber} is active until ${expiresAt.toISOString().slice(0, 10)}.`,
        recordType: "BreederCertification",
        recordId: certification.id,
      });
    }

    return certification;
  });
}

/*
 * Farmer's own breeder dashboard: one entry per Parent Stock release,
 * refreshed against the date rules before returning.
 */
export async function getMyBreederStatus(userId: string) {
  return prisma.$transaction(async (transaction) => {
    const customer = await transaction.customerProfile.findFirst({
      where: { userId, archivedAt: null },
      select: { id: true, customerNumber: true },
    });

    if (!customer) {
      throw new HttpError(
        404,
        "No active customer profile is linked to this account."
      );
    }

    const monitoringIds = await transaction.breederMonitoring.findMany({
      where: { customerProfileId: customer.id },
      select: { id: true },
    });

    for (const { id } of monitoringIds) {
      await refreshEligibility(transaction, id);
      await refreshCertificationStatuses(transaction, id);
    }

    const monitorings = await transaction.breederMonitoring.findMany({
      where: { customerProfileId: customer.id },
      include: BREEDER_RECORD_INCLUDE,
      orderBy: { releasedAt: "desc" },
    });

    const breeders = monitorings
      .filter((monitoring) => monitoring.eligibility)
      .map((monitoring) => {
        const latestCertificate = monitoring.certifications[0] ?? null;

        return {
          monitoringId: monitoring.id,
          farm: monitoring.farm,
          parentStockOrder: monitoring.parentStockOrder,
          releasedAt: monitoring.releasedAt,
          eligibleAt: monitoring.eligibleAt,
          eligibilityStatus: monitoring.eligibility!.status,
          eligibilityRemarks: monitoring.eligibility!.remarks,
          certification: latestCertificate,
          overallStatus: calculateOverallBreederStatus(
            monitoring.eligibility!.status,
            latestCertificate?.status ?? null
          ),
          monitoring: {
            breederDate: monitoring.breederDate,
            numberAlive: monitoring.numberAlive,
            vaccinationRecords: monitoring.vaccinationRecords,
            feedingManagement: monitoring.feedingManagement,
            healthManagement: monitoring.healthManagement,
            weightManagement: monitoring.weightManagement,
            breedersClaimed: monitoring.breedersClaimed,
          },
        };
      });

    return {
      customerNumber: customer.customerNumber,
      breeders,
    };
  });
}

/*
 * Staff Certified Breeder Registry: filterable by overall status,
 * region, and province (via the linked farm).
 */
export async function listBreederRecords(filters: {
  status?: "ACTIVE" | "PENDING" | "EXPIRED" | "INELIGIBLE";
  region?: string;
  province?: string;
}) {
  return prisma.$transaction(async (transaction) => {
    const monitoringIds = await transaction.breederMonitoring.findMany({
      select: { id: true },
    });

    for (const { id } of monitoringIds) {
      await refreshEligibility(transaction, id);
      await refreshCertificationStatuses(transaction, id);
    }

    const monitorings = await transaction.breederMonitoring.findMany({
      where: {
        farm: {
          ...(filters.region
            ? { region: { equals: filters.region, mode: "insensitive" } }
            : {}),
          ...(filters.province
            ? { province: { equals: filters.province, mode: "insensitive" } }
            : {}),
        },
      },
      include: {
        customerProfile: {
          /* The admin Breeder Monitoring table shows the customer's
             contact block (address/facebook) beside the farm data. */
          select: {
            id: true,
            customerNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
            phoneNumber: true,
            contactEmail: true,
            facebookName: true,
            addressLine1: true,
            barangay: true,
            cityMunicipality: true,
            province: true,
          },
        },
        ...BREEDER_RECORD_INCLUDE,
      },
      orderBy: { releasedAt: "desc" },
    });

    return monitorings
      .filter((monitoring) => monitoring.eligibility)
      .map((monitoring) => {
        const latestCertificate = monitoring.certifications[0] ?? null;

        return {
          ...monitoring,
          latestCertification: latestCertificate,
          overallStatus: calculateOverallBreederStatus(
            monitoring.eligibility!.status,
            latestCertificate?.status ?? null
          ),
        };
      })
      .filter(
        (record) => !filters.status || record.overallStatus === filters.status
      );
  });
}

export async function getBreederRecord(monitoringId: string) {
  return prisma.$transaction(async (transaction) => {
    await refreshEligibility(transaction, monitoringId);
    await refreshCertificationStatuses(transaction, monitoringId);

    const monitoring = await transaction.breederMonitoring.findUnique({
      where: { id: monitoringId },
      include: {
        customerProfile: {
          select: {
            id: true,
            customerNumber: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            contactEmail: true,
          },
        },
        farm: true,
        parentStockOrder: {
          select: {
            id: true,
            orderNumber: true,
            orderType: true,
            status: true,
            releasedAt: true,
          },
        },
        eligibility: {
          include: {
            evaluatedBy: { select: { id: true, email: true } },
          },
        },
        certifications: {
          orderBy: { certifiedAt: "desc" },
          include: {
            issuedBy: { select: { id: true, email: true } },
          },
        },
      },
    });

    if (!monitoring) {
      throw new HttpError(404, "Breeder monitoring record was not found.");
    }

    const latestCertificate = monitoring.certifications[0] ?? null;

    return {
      ...monitoring,
      latestCertification: latestCertificate,
      overallStatus: monitoring.eligibility
        ? calculateOverallBreederStatus(
            monitoring.eligibility.status,
            latestCertificate?.status ?? null
          )
        : ("PENDING" as const),
    };
  });
}
