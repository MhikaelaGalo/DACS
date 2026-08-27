import type { OrderStatus } from "@/constants/statuses";

export type ShippingMethod =
  | "Air shipment"
  | "Land Transport (Delivery)"
  | "Farm Pick Up (Rizal, Philippines)";

/*
 * The mock Order/OrderReceipt models were removed with the backend
 * integration — real orders come from GET /api/orders/me (see
 * src/lib/api/orders.ts). OrderStatus display labels live in
 * constants/statuses.ts.
 */
export type { OrderStatus };
