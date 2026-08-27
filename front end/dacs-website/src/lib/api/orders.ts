/*
 * Farmer order + payment endpoints. Shapes mirror the backend responses
 * field for field (back end/src/modules/orders + payments). All money
 * fields are Prisma Decimals serialized as strings — convert with
 * Number() at the display edge.
 */
import { api } from "../api";

export type ApiOrderType = "PARENT_STOCK" | "F1" | "VETERINARY_PRODUCT" | "SEMINAR";
export type ApiOrderStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PAYMENT_SUBMITTED"
  | "PAYMENT_VERIFIED"
  | "PROCESSING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED";

export interface ApiOrderItem {
  id: string;
  orderId: string;
  /** PRODUCT lines link a product; SEMINAR_MODULE lines link a module. */
  itemType: "PRODUCT" | "SEMINAR_MODULE";
  productId: string | null;
  seminarModuleId: string | null;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  unitPriceSnapshot: string;
  quantity: number;
  lineTotal: string;
}

export interface ApiOrderStatusHistory {
  id: string;
  fromStatus: ApiOrderStatus | null;
  toStatus: ApiOrderStatus;
  notes: string | null;
  createdAt: string;
}

export interface ApiOrder {
  id: string;
  orderNumber: string;
  orderType: ApiOrderType;
  status: ApiOrderStatus;
  dateNeeded: string | null;
  hatchDate: string | null;
  releasedAt: string | null;
  receiverName: string | null;
  receiverFacebook: string | null;
  receiverContact: string | null;
  fulfillmentMethod: "PICKUP" | "LBC_BRANCH" | "AIRPORT" | "DELIVERY" | null;
  deliveryAddress: string | null;
  airportLocation: string | null;
  pickupBranch: string | null;
  instructions: string | null;
  depositPercent: number | null;
  depositDueDate: string | null;
  balanceDueDate: string | null;
  subtotal: string;
  feeTotal: string;
  totalAmount: string;
  /*
   * Checkout + 14 days. The backend stores this per order and cancels
   * unpaid PENDING/APPROVED orders past it automatically; null only on
   * historical imports.
   */
  paymentDeadlineAt: string | null;
  createdAt: string;
  items: ApiOrderItem[];
  statusHistory: ApiOrderStatusHistory[];
}

export interface CreateOrderBody {
  orderType: ApiOrderType;
  dateNeeded?: string | null;
  receiverName?: string | null;
  receiverFacebook?: string | null;
  receiverContact?: string | null;
  fulfillmentMethod?: "PICKUP" | "LBC_BRANCH" | "AIRPORT" | "DELIVERY" | null;
  deliveryAddress?: string | null;
  airportLocation?: string | null;
  pickupBranch?: string | null;
  instructions?: string | null;
  /** Exactly one of productId / seminarModuleId per item (seminar items
   *  belong in SEMINAR orders, quantity always 1). */
  items: Array<{
    productId?: string;
    seminarModuleId?: string;
    quantity: number;
  }>;
}

export async function createOrder(body: CreateOrderBody): Promise<ApiOrder> {
  const response = await api.post<{ data: ApiOrder }>("/api/orders", body);
  return response.data;
}

export async function listMyOrders(): Promise<ApiOrder[]> {
  const response = await api.get<{ data: ApiOrder[] }>("/api/orders/me");
  return response.data;
}

export async function getMyOrder(orderId: string): Promise<ApiOrder> {
  const response = await api.get<{ data: ApiOrder }>(
    `/api/orders/me/${orderId}`
  );
  return response.data;
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export type ApiPaymentType =
  | "DEPOSIT"
  | "BALANCE"
  | "FULL"
  | "SHIPPING_FEE"
  | "PROCESSING_FEE";
export type ApiPaymentStatus = "SUBMITTED" | "VERIFIED" | "REJECTED";

export interface ApiPayment {
  id: string;
  orderId: string;
  paymentType: ApiPaymentType;
  status: ApiPaymentStatus;
  amount: string;
  paymentDate: string | null;
  referenceNumber: string | null;
  proofStorageUrl: string | null;
  rejectionReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
  order?: {
    id: string;
    orderNumber: string;
    orderType: ApiOrderType;
    status: ApiOrderStatus;
    totalAmount: string;
  };
}

/*
 * The in-app proof-of-payment upload was retired: customers email their
 * proof to DACS (see PaymentDeadlineNotice) and staff record it. The
 * payments listed here include those staff-recorded rows.
 */
export async function listMyPayments(): Promise<ApiPayment[]> {
  const response = await api.get<{ data: ApiPayment[] }>("/api/payments/me");
  return response.data;
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

export const ORDER_STATUS_LABELS: Record<ApiOrderStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PAYMENT_SUBMITTED: "Payment Under Review",
  PAYMENT_VERIFIED: "Payment Verified",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export const ORDER_TYPE_LABELS: Record<ApiOrderType, string> = {
  PARENT_STOCK: "Parent Stocks (PS)",
  F1: "First Filial (F1)",
  VETERINARY_PRODUCT: "Veterinary Products",
  SEMINAR: "Seminar",
};

export const PAYMENT_TYPE_LABELS: Record<ApiPaymentType, string> = {
  DEPOSIT: "Deposit",
  BALANCE: "Balance",
  FULL: "Full Payment",
  SHIPPING_FEE: "Shipping Fee",
  PROCESSING_FEE: "Processing Fee",
};

export const PAYMENT_STATUS_LABELS: Record<ApiPaymentStatus, string> = {
  SUBMITTED: "Under Review",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
};

export function fulfillmentLabel(order: ApiOrder): string {
  // Seminar purchases are digital: access unlocks in the seminar page
  // once payment is verified — nothing ships anywhere.
  if (order.orderType === "SEMINAR") {
    return "Online seminar access — unlocked after payment verification";
  }
  switch (order.fulfillmentMethod) {
    case "PICKUP":
      return order.pickupBranch
        ? `Pick Up — ${order.pickupBranch}`
        : "Farm Pick Up";
    case "AIRPORT":
      return order.airportLocation
        ? `Air Shipment — ${order.airportLocation}`
        : "Air Shipment";
    case "DELIVERY":
      return order.deliveryAddress
        ? `Delivery — ${order.deliveryAddress}`
        : "Delivery";
    case "LBC_BRANCH":
      return order.pickupBranch
        ? `LBC Branch — ${order.pickupBranch}`
        : "LBC Branch";
    default:
      return "To be arranged";
  }
}
