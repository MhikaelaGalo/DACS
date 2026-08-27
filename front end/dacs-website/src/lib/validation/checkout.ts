import { z } from "zod";

/*
 * Checkout form. The delivery address is only meaningful when the cart
 * holds physical products — seminar-module purchases are digital access,
 * so a seminar-only checkout collects contact details alone.
 */
export function makeCheckoutSchema(requireDeliveryAddress: boolean) {
  return z.object({
    fullName: z.string().min(1, "Full name is required"),
    contactNumber: z.string().min(1, "Contact number is required"),
    email: z.string().min(1, "Email is required").email("Enter a valid email"),
    deliveryAddress: requireDeliveryAddress
      ? z.string().min(1, "Delivery address is required")
      : z.string(),
  });
}

export const checkoutSchema = makeCheckoutSchema(true);

export type CheckoutFormValues = z.infer<typeof checkoutSchema>;
