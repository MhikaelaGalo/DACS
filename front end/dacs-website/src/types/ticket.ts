/** Inquiry categories selectable on the Submit a Ticket form. */
export type TicketCategory =
  | "Products"
  | "Parent Stocks"
  | "First Filial Generation (F1)"
  | "Veterinary Products"
  | "Seminars"
  | "Seminar Certificate"
  | "Orders"
  | "Payments"
  | "Breeder Eligibility"
  | "Breeder Certification"
  | "Account Support"
  | "Technical Support"
  | "Other";

/*
 * The mock Ticket model was removed with the backend integration — real
 * tickets come from /api/inquiries (see src/lib/api/inquiries.ts).
 */
