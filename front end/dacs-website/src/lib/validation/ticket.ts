import { z } from "zod";
import type { TicketCategory } from "@/types/ticket";

/** Dropdown options of the Submit a Ticket "Inquiry Category" field. */
export const TICKET_CATEGORIES = [
  "Products",
  "Parent Stocks",
  "First Filial Generation (F1)",
  "Veterinary Products",
  "Seminars",
  "Seminar Certificate",
  "Orders",
  "Payments",
  "Breeder Eligibility",
  "Breeder Certification",
  "Account Support",
  "Technical Support",
  "Other",
] as const satisfies readonly TicketCategory[];

export const ticketSchema = z.object({
  category: z
    .union([z.enum(TICKET_CATEGORIES), z.literal("")])
    // The `boolean` annotation stops TS from inferring a type predicate here,
    // which would otherwise split the schema's input/output types.
    .refine((value): boolean => value !== "", {
      message: "Inquiry category is required",
    }),
  subject: z.string().min(1, "Subject is required"),
  description: z.string().min(1, "Description is required"),
  orderReference: z.string(),
  paymentReference: z.string(),
  email: z
    .string()
    .min(1, "Contact email is required")
    .email("Enter a valid email"),
  contactNumber: z.string(),
  confirmed: z.boolean().refine((value) => value, {
    message: "Please confirm that the information provided is correct",
  }),
});

export type TicketFormValues = z.infer<typeof ticketSchema>;
