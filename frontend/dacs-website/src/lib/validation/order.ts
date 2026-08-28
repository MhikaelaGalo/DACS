import { z } from "zod";
import { MONTHS } from "@/constants/months";
import type { ShippingMethod } from "@/types/order";

/** The three ways PS chicks can be received (Figma: Receive PS Chicks 252:1121). */
export const SHIPPING_METHODS = [
  "Air shipment",
  "Land Transport (Delivery)",
  "Farm Pick Up (Rizal, Philippines)",
] as const satisfies readonly ShippingMethod[];

// Figma: Parent Stocks (PS) Order Form (252:756)
export const psOrderSchema = z
  .object({
    purpose: z.string().min(1, "Purpose of breeding is required"),
    shippingMethod: z.enum(SHIPPING_METHODS),
    firstChoiceAirport: z.string(),
    secondChoiceAirport: z.string(),
    airShipmentAcknowledged: z.boolean(),
    receiverSameAsOwner: z.boolean(),
    receiverName: z.string().min(1, "Name of receiver is required"),
    receiverContactNumber: z
      .string()
      .min(1, "Receiver's contact number is required"),
    receiverFacebook: z.string().min(1, "Facebook Link is required"),
    receiverMessenger: z.string().min(1, "Messenger Link is required"),
    breeds: z.array(z.string()).min(1, "Select at least one breed to order"),
  })
  .superRefine((data, ctx) => {
    if (data.shippingMethod !== "Air shipment") return;
    if (!data.firstChoiceAirport.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["firstChoiceAirport"],
        message: "First-choice destination airport is required",
      });
    }
    if (!data.secondChoiceAirport.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["secondChoiceAirport"],
        message: "Second-choice destination airport is required",
      });
    }
    if (!data.airShipmentAcknowledged) {
      ctx.addIssue({
        code: "custom",
        path: ["airShipmentAcknowledged"],
        message: "Please acknowledge the air shipment notice",
      });
    }
  });

export type PsOrderFormValues = z.infer<typeof psOrderSchema>;

/** Options of the "When do you need your F1 chicks?" selector (Figma: When need F1 255:2400). */
export const F1_SCHEDULE_OPTIONS = [...MONTHS, "Other"] as const;

export type F1ScheduleOption = (typeof F1_SCHEDULE_OPTIONS)[number];

// Figma: First Filial Generation (F1) Order Form (450:1569 / 255:3697)
export const f1OrderSchema = z
  .object({
    layerSelected: z.boolean(),
    layerAmount: z.string(),
    inasalSelected: z.boolean(),
    inasalAmount: z.string(),
    artisanSelected: z.boolean(),
    artisanAmount: z.string(),
    neededMonth: z.enum(F1_SCHEDULE_OPTIONS),
    otherSchedule: z.string(),
  })
  .superRefine((data, ctx) => {
    if (!data.layerSelected && !data.inasalSelected && !data.artisanSelected) {
      ctx.addIssue({
        code: "custom",
        path: ["layerSelected"],
        message: "Select at least one F1 line to order",
      });
    }

    const checkAmount = (
      selected: boolean,
      amount: string,
      path: "layerAmount" | "inasalAmount" | "artisanAmount",
      minimum: number
    ) => {
      if (!selected) return;
      if (!amount.trim()) {
        ctx.addIssue({ code: "custom", path: [path], message: "Amount is required" });
        return;
      }
      const heads = Number(amount);
      if (!Number.isInteger(heads) || heads <= 0) {
        ctx.addIssue({
          code: "custom",
          path: [path],
          message: "Enter a valid number of heads",
        });
        return;
      }
      if (heads < minimum) {
        ctx.addIssue({
          code: "custom",
          path: [path],
          message: `Minimum order quantity is ${minimum} heads`,
        });
      }
    };

    // Minimums follow the pricing shown on the form: Layer/Inasal price
    // tiers start at 50 heads; Artisan MOQ is 65 heads.
    checkAmount(data.layerSelected, data.layerAmount, "layerAmount", 50);
    checkAmount(data.inasalSelected, data.inasalAmount, "inasalAmount", 50);
    checkAmount(data.artisanSelected, data.artisanAmount, "artisanAmount", 65);

    if (data.neededMonth === "Other" && !data.otherSchedule.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["otherSchedule"],
        message: "Please describe your order schedule",
      });
    }
  });

export type F1OrderFormValues = z.infer<typeof f1OrderSchema>;
