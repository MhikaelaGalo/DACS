/*
 * Farmer inquiry (support ticket) endpoints. Shapes mirror the backend
 * (back end/src/modules/inquiries). Responses are sent by staff through
 * the organization's official email — the ticket records the status.
 */
import { api } from "../api";

export type ApiTicketStatus =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "RESPONDED"
  | "CLOSED";

export interface ApiTicketStatusHistory {
  id: string;
  fromStatus: ApiTicketStatus | null;
  toStatus: ApiTicketStatus;
  notes: string | null;
  createdAt: string;
}

export interface ApiInquiryTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  message: string;
  status: ApiTicketStatus;
  category: string | null;
  priority: string | null;
  relatedOrder: { id: string; orderNumber: string; status: string } | null;
  emailRespondedAt: string | null;
  createdAt: string;
  statusHistory?: ApiTicketStatusHistory[];
}

export const TICKET_STATUS_LABELS: Record<ApiTicketStatus, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under Review",
  RESPONDED: "Responded",
  CLOSED: "Closed",
};

export async function createInquiry(body: {
  subject: string;
  message: string;
  relatedOrderId?: string;
}): Promise<ApiInquiryTicket> {
  const response = await api.post<{ data: ApiInquiryTicket }>(
    "/api/inquiries",
    body
  );
  return response.data;
}

export async function listMyInquiries(): Promise<ApiInquiryTicket[]> {
  const response = await api.get<{ data: ApiInquiryTicket[] }>(
    "/api/inquiries/me"
  );
  return response.data;
}

export async function getMyInquiry(
  ticketId: string
): Promise<ApiInquiryTicket> {
  const response = await api.get<{ data: ApiInquiryTicket }>(
    `/api/inquiries/me/${ticketId}`
  );
  return response.data;
}
