/*
 * Breeder monitoring (staff read side). Mirrors
 * back end/src/modules/breeders — GET /api/breeders returns one record
 * per Parent Stock release with the farm, customer, eligibility and
 * date-aware overall status.
 */
import { api } from "../api";
import type { BreederMonitoringRow } from "@/types/admin";

interface ApiBreederCustomer {
  id: string;
  customerNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  phoneNumber: string | null;
  contactEmail: string | null;
  facebookName: string | null;
  addressLine1: string | null;
  barangay: string | null;
  cityMunicipality: string | null;
  province: string | null;
}

interface ApiBreederFarm {
  id: string;
  farmName: string;
  addressLine1: string | null;
  barangay: string | null;
  cityMunicipality: string | null;
  province: string | null;
  farmLogoUrl: string | null;
}

interface ApiBreederRecord {
  id: string;
  breederDate: string | null;
  numberAlive: string | null;
  vaccinationRecords: string | null;
  feedingManagement: string | null;
  healthManagement: string | null;
  weightManagement: string | null;
  breedersClaimed: string | null;
  overallStatus: "ACTIVE" | "PENDING" | "EXPIRED" | "INELIGIBLE";
  customerProfile: ApiBreederCustomer;
  farm: ApiBreederFarm;
}

function joinParts(parts: Array<string | null | undefined>, glue = ", "): string {
  return parts.filter(Boolean).join(glue);
}

function toBreederRow(record: ApiBreederRecord): BreederMonitoringRow {
  const profile = record.customerProfile;
  const managementNotes = joinParts(
    [record.feedingManagement, record.healthManagement, record.weightManagement],
    " · "
  );
  return {
    id: record.id,
    customerNumber: profile.customerNumber,
    name: joinParts([profile.firstName, profile.lastName], " "),
    address:
      joinParts([
        profile.addressLine1,
        profile.barangay,
        profile.cityMunicipality,
        profile.province,
      ]) || "N/A",
    contactNumber: profile.phoneNumber ?? "N/A",
    email: profile.contactEmail ?? "N/A",
    facebookName: profile.facebookName ?? "N/A",
    farmName: record.farm.farmName,
    farmAddress:
      joinParts([
        record.farm.addressLine1,
        record.farm.barangay,
        record.farm.cityMunicipality,
        record.farm.province,
      ]) || "N/A",
    breederDate: record.breederDate ? record.breederDate.slice(0, 10) : null,
    numberAlive: record.numberAlive,
    vaccinationRecords: record.vaccinationRecords,
    feedingHealthWeight: managementNotes || null,
    breedersClaimed: record.breedersClaimed,
    overallStatus: record.overallStatus,
    /* Farms without an uploaded logo fall back to the DACS logo. */
    farmLogo: record.farm.farmLogoUrl ?? "/dacs-logo.png",
  };
}

export async function listBreederRows(): Promise<BreederMonitoringRow[]> {
  const response = await api.get<{ data: ApiBreederRecord[] }>("/api/breeders");
  return response.data.map(toBreederRow);
}
