/*
 * Staff seminar-progress overview (admin monitoring table). Mirrors
 * back end GET /api/seminars/progress: one entry per customer with
 * seminar enrollments.
 *
 * Model notes surfaced honestly: "Failed" is not a backend state
 * (quizzes are retakeable), and seminars carry no payment — the Pay
 * Date column stays N/A until the client decides on paid seminars.
 */
import { api } from "../api";
import type { SeminarProgressRow } from "@/types/admin";

interface ApiSeminarProgressEntry {
  id: string;
  customerNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  occupation: string | null;
  phoneNumber: string | null;
  contactEmail: string | null;
  facebookName: string | null;
  addressLine1: string | null;
  barangay: string | null;
  cityMunicipality: string | null;
  province: string | null;
  seminarEnrollments: Array<{
    startedAt: string;
    completedAt: string | null;
    module: { moduleNumber: number; title: string; archivedAt: string | null };
  }>;
  certificateRequests: Array<{
    id: string;
    status: string;
    certificateNumber: string | null;
    certificateIssuedAt: string | null;
    certificateFileName: string | null;
    certificateFileMimeType: string | null;
    fileUploadedAt: string | null;
    issuedAt: string | null;
    validUntil: string | null;
  }>;
}

/*
 * Certificate validity, derived at render time from the dates DACS
 * stamped on the record when it generated the certificate: NOT_ISSUED
 * while no certificate exists, VALID strictly before the expiry
 * instant, EXPIRED on/after it. Staff never choose this — certificates
 * both appear and expire automatically.
 */
export type CertificateValidity = "NOT_ISSUED" | "VALID" | "EXPIRED";

export function certificateValidity(
  issuedAt: string | null,
  validUntil: string | null
): CertificateValidity {
  if (!issuedAt || !validUntil) return "NOT_ISSUED";
  return Date.now() < Date.parse(validUntil) ? "VALID" : "EXPIRED";
}

function toProgressRow(entry: ApiSeminarProgressEntry): SeminarProgressRow {
  const location = [entry.cityMunicipality, entry.province]
    .filter(Boolean)
    .join(", ");
  const activeEnrollments = entry.seminarEnrollments.filter(
    (enrollment) => enrollment.module.archivedAt === null
  );
  const relevant = activeEnrollments.length
    ? activeEnrollments
    : entry.seminarEnrollments;
  const registration = relevant
    .map((enrollment) => enrollment.startedAt)
    .sort()[0];
  const certificate = entry.certificateRequests[0] ?? null;
  return {
    id: entry.id,
    customerNumber: entry.customerNumber,
    name: [entry.firstName, entry.lastName].filter(Boolean).join(" "),
    address:
      [entry.addressLine1, entry.barangay, entry.cityMunicipality, entry.province]
        .filter(Boolean)
        .join(", ") || "N/A",
    contactNumber: entry.phoneNumber ?? "N/A",
    email: entry.contactEmail ?? "N/A",
    facebookName: entry.facebookName ?? "N/A",
    occupationLocation:
      [entry.occupation, location].filter(Boolean).join(" | ") || "N/A",
    status: relevant.every((enrollment) => enrollment.completedAt)
      ? "Completed"
      : "In Progress",
    modules: relevant
      .map((enrollment) => enrollment.module.moduleNumber)
      .join(", "),
    seminarId: certificate?.certificateNumber ?? "N/A",
    registrationDate: registration ? registration.slice(0, 10) : "",
    payDate: "",
    certificateRequestId: certificate?.id ?? null,
    hasCertificateFile: certificate?.certificateFileName != null,
    certificateFileName: certificate?.certificateFileName ?? null,
    certificateIssuedAt: certificate?.issuedAt ?? null,
    certificateValidUntil: certificate?.validUntil ?? null,
  };
}

export async function listSeminarProgressRows(): Promise<SeminarProgressRow[]> {
  const response = await api.get<{ data: ApiSeminarProgressEntry[] }>(
    "/api/seminars/progress"
  );
  return response.data.map(toProgressRow);
}
