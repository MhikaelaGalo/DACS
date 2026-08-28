/*
 * Inquiry tickets (staff read side for the monitoring table). Mirrors
 * back end/src/modules/inquiries.
 */
import { api } from "../api";
import type { TicketRow } from "@/types/admin";

interface ApiTicketCustomer {
  id: string;
  customerNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  contactEmail: string | null;
  phoneNumber: string | null;
  facebookName: string | null;
  addressLine1: string | null;
  barangay: string | null;
  cityMunicipality: string | null;
  province: string | null;
}

interface ApiInquiryTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  category: string | null;
  priority: string | null;
  status: "SUBMITTED" | "UNDER_REVIEW" | "RESPONDED" | "CLOSED";
  createdAt: string;
  customerProfile: ApiTicketCustomer | null;
}

function toTicketRow(ticket: ApiInquiryTicket): TicketRow {
  const profile = ticket.customerProfile;
  const address = [
    profile?.addressLine1,
    profile?.barangay,
    profile?.cityMunicipality,
    profile?.province,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    id: ticket.id,
    customerNumber: profile?.customerNumber ?? "",
    name: [profile?.firstName, profile?.lastName].filter(Boolean).join(" "),
    address: address || "N/A",
    contactNumber: profile?.phoneNumber ?? "N/A",
    email: profile?.contactEmail ?? "N/A",
    facebookName: profile?.facebookName ?? "N/A",
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    createdAt: ticket.createdAt.slice(0, 10),
  };
}

export async function listTicketRows(pageSize = 100): Promise<TicketRow[]> {
  const response = await api.get<{ data: ApiInquiryTicket[] }>(
    "/api/inquiries",
    { pageSize }
  );
  return response.data.map(toTicketRow);
}
