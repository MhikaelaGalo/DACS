/*
 * Orders (staff side) + the mappers that compose the admin queue and
 * tracking rows from backend records. Mirrors
 * back end/src/modules/orders.
 *
 * Known model limits surfaced honestly rather than faked:
 *  - F1 price BANDS are not modeled server-side (products carry one
 *    unitPrice), so priceMin/priceMax both show the catalog price.
 *  - Parent Stock female/male component splits are not modeled on
 *    order items; PS lines map into the female columns and quantity
 *    edits round-trip as the row's total birds.
 */
import { api } from "../api";
import type { ApiPayment } from "./payments";
import type { ApiProduct } from "./products";
import type {
  F1LineItem,
  OrderQueueRow,
  OrderStatus,
  OrderTrackingRow,
  OrderType,
  PsLineItem,
  SeminarLineItem,
  VetLineItem,
} from "@/types/admin";

export interface ApiOrderItem {
  id: string;
  orderId: string;
  /* PRODUCT lines link a product; SEMINAR_MODULE lines link a module. */
  itemType: "PRODUCT" | "SEMINAR_MODULE";
  productId: string | null;
  seminarModuleId: string | null;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  /* Prisma Decimals — serialized as strings. */
  unitPriceSnapshot: string;
  quantity: number;
  lineTotal: string;
  createdAt: string;
}

export interface ApiOrderCustomer {
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

export interface ApiOrder {
  id: string;
  orderNumber: string;
  customerProfileId: string;
  orderType: OrderType;
  status: OrderStatus;
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
  /* Checkout + 14 days; unpaid orders past it are auto-cancelled by the
     backend. NULL on historical imports. */
  paymentDeadlineAt: string | null;
  /* HISTORICAL_IMPORT orders were migrated from legacy spreadsheets. */
  source: "LIVE" | "HISTORICAL_IMPORT";
  createdAt: string;
  updatedAt: string;
  items: ApiOrderItem[];
  customerProfile?: ApiOrderCustomer;
  /* Order detail additionally carries the profile's farms. */
  customerProfileDetail?: unknown;
}

export interface ApiOrderDetail extends Omit<ApiOrder, "customerProfile"> {
  customerProfile: ApiOrderCustomer & {
    farms?: Array<{ id: string; farmName: string; isPrimary: boolean }>;
  };
  /* Payment history (legacy summaries carry no proof file). */
  payments?: ApiPayment[];
}

function dateOnly(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

function toNumber(decimal: string | null | undefined): number {
  const parsed = Number(decimal);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function customerDisplayName(profile?: ApiOrderCustomer): string {
  if (!profile) return "";
  return [profile.firstName, profile.lastName].filter(Boolean).join(" ");
}

export function customerDisplayAddress(profile?: ApiOrderCustomer): string {
  if (!profile) return "";
  return [
    profile.addressLine1,
    profile.barangay,
    profile.cityMunicipality,
    profile.province,
  ]
    .filter(Boolean)
    .join(", ");
}

function vetItemsFor(order: ApiOrder, products: ApiProduct[]): VetLineItem[] {
  const catalog = products.filter(
    (product) => product.category === "VETERINARY_PRODUCT" && product.isActive
  );
  const rows: VetLineItem[] = catalog.map((product) => {
    const item = order.items.find((entry) => entry.productId === product.id);
    return {
      productId: product.id,
      product: product.name,
      quantity: item?.quantity ?? 0,
      unit: product.unit ?? "",
      price: toNumber(item?.unitPriceSnapshot ?? product.unitPrice),
    };
  });
  /* Items whose product left the active catalog still belong on the
     quotation — appended from their snapshots. */
  for (const item of order.items) {
    if (!catalog.some((product) => product.id === item.productId)) {
      rows.push({
        productId: item.productId ?? undefined,
        product: item.productNameSnapshot,
        quantity: item.quantity,
        unit: "",
        price: toNumber(item.unitPriceSnapshot),
      });
    }
  }
  return rows;
}

function f1ItemsFor(order: ApiOrder, products: ApiProduct[]): F1LineItem[] {
  return order.items.map((item) => {
    const product = products.find((entry) => entry.id === item.productId);
    const catalogPrice = toNumber(product?.unitPrice ?? item.unitPriceSnapshot);
    return {
      productId: item.productId ?? undefined,
      product: item.productNameSnapshot,
      quantity: item.quantity,
      priceMin: catalogPrice,
      priceMax: catalogPrice,
      unitPrice: toNumber(item.unitPriceSnapshot),
    };
  });
}

function psItemsFor(order: ApiOrder): PsLineItem[] {
  return order.items.map((item) => ({
    productId: item.productId ?? undefined,
    product: item.productNameSnapshot,
    sets: item.quantity,
    qtyF: item.quantity,
    upF: toNumber(item.unitPriceSnapshot),
    qtyM: 0,
    upM: 0,
    qtyAddM: 0,
    upAddM: 0,
    amtF: toNumber(item.lineTotal),
    amtM: 0,
  }));
}

/* SEMINAR orders: one module-access line per item, quantity always 1. */
function seminarItemsFor(order: ApiOrder): SeminarLineItem[] {
  return order.items.map((item) => ({
    seminarModuleId: item.seminarModuleId,
    module: item.productNameSnapshot,
    quantity: item.quantity,
    price: toNumber(item.unitPriceSnapshot),
  }));
}

export function toOrderQueueRow(
  order: ApiOrder,
  products: ApiProduct[]
): OrderQueueRow {
  const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerNumber: order.customerProfile?.customerNumber ?? "",
    customerName: customerDisplayName(order.customerProfile),
    email: order.customerProfile?.contactEmail ?? "",
    productSummary: order.items
      .map((item) => item.productNameSnapshot)
      .join(", "),
    source: order.source,
    orderType: order.orderType,
    quantity,
    totalAmount: toNumber(order.totalAmount),
    dateNeeded: dateOnly(order.dateNeeded),
    hatchDate: dateOnly(order.hatchDate),
    status: order.status,
    receiverName: order.receiverName,
    receiverFacebook: order.receiverFacebook,
    receiverContact: order.receiverContact,
    fulfillmentMethod: order.fulfillmentMethod,
    deliveryAddress: order.deliveryAddress,
    airportLocation: order.airportLocation,
    pickupBranch: order.pickupBranch,
    instructions: order.instructions,
    feeTotal: toNumber(order.feeTotal),
    paymentDate: null,
    farmName: null,
    /* The OQ date is when the quotation (order) was created. */
    oqDate: dateOnly(order.createdAt),
    depositPercent: order.depositPercent,
    depositDueDate: dateOnly(order.depositDueDate),
    balancePercent:
      order.depositPercent === null ? null : 100 - order.depositPercent,
    balanceDueDate: dateOnly(order.balanceDueDate),
    ...(order.orderType === "VETERINARY_PRODUCT"
      ? { vetItems: vetItemsFor(order, products) }
      : order.orderType === "F1"
        ? { f1Items: f1ItemsFor(order, products) }
        : order.orderType === "SEMINAR"
          ? { seminarItems: seminarItemsFor(order) }
          : { psItems: psItemsFor(order) }),
  };
}

const TRACKING_LABELS: Partial<Record<OrderStatus, OrderTrackingRow["trackingStatus"]>> = {
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
};

export function toOrderTrackingRow(
  order: ApiOrder,
  paymentDateByOrder: Map<string, string>
): OrderTrackingRow | null {
  const trackingStatus = TRACKING_LABELS[order.status];
  if (!trackingStatus) return null;
  const profile = order.customerProfile;
  return {
    id: order.id,
    source: order.source,
    customerNumber: profile?.customerNumber ?? "",
    name: customerDisplayName(profile),
    address: customerDisplayAddress(profile) || "N/A",
    contactNumber: profile?.phoneNumber ?? "N/A",
    email: profile?.contactEmail ?? "N/A",
    facebookName: profile?.facebookName ?? "N/A",
    trackingStatus,
    receiverName: order.receiverName ?? "N/A",
    receiverFacebook: order.receiverFacebook ?? "N/A",
    receiverContact: order.receiverContact ?? "N/A",
    quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
    totalAmount: toNumber(order.totalAmount),
    hatchDate: dateOnly(order.hatchDate),
    airportLocation: order.airportLocation,
    paymentDate: paymentDateByOrder.get(order.id) ?? null,
    instructions: order.instructions,
    feeTotal: toNumber(order.feeTotal),
    pickupBranch: order.pickupBranch,
  };
}

/* Latest VERIFIED payment date per order, for the Pay Date column. */
export function paymentDatesByOrder(payments: ApiPayment[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const payment of payments) {
    if (payment.status !== "VERIFIED" || !payment.paymentDate) continue;
    const date = payment.paymentDate.slice(0, 10);
    const existing = map.get(payment.orderId);
    if (!existing || date > existing) map.set(payment.orderId, date);
  }
  return map;
}

/* PATCH /api/orders/:id body from the edit modal's computed row. */
export function toOrderEditBody(row: OrderQueueRow): {
  body: Record<string, unknown>;
  itemCount: number;
} {
  const items: Array<{ productId: string; quantity: number; unitPrice?: number }> =
    [];
  if (row.vetItems) {
    for (const item of row.vetItems) {
      if (item.quantity > 0 && item.productId) {
        items.push({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.price,
        });
      }
    }
  } else if (row.f1Items) {
    for (const item of row.f1Items) {
      if (item.quantity > 0 && item.productId) {
        items.push({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        });
      }
    }
  } else if (row.psItems) {
    for (const item of row.psItems) {
      const quantity = item.qtyF + item.qtyM + item.qtyAddM;
      if (quantity > 0 && item.productId) {
        items.push({ productId: item.productId, quantity, unitPrice: item.upF });
      }
    }
  }
  return {
    body: {
      items,
      receiverName: row.receiverName,
      deliveryAddress: row.deliveryAddress,
      airportLocation: row.airportLocation,
      pickupBranch: row.pickupBranch,
    },
    itemCount: items.length,
  };
}

export async function listOrders(): Promise<ApiOrder[]> {
  const response = await api.get<{ data: ApiOrder[] }>("/api/orders");
  return response.data;
}

export async function getOrder(orderId: string): Promise<ApiOrderDetail> {
  const response = await api.get<{ data: ApiOrderDetail }>(
    `/api/orders/${orderId}`
  );
  return response.data;
}

export async function updateOrderStatus(
  orderId: string,
  status: "APPROVED" | "REJECTED" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED",
  notes?: string
): Promise<ApiOrder> {
  const response = await api.patch<{ data: ApiOrder }>(
    `/api/orders/${orderId}/status`,
    notes ? { status, notes } : { status }
  );
  return response.data;
}

export async function updateOrder(
  orderId: string,
  body: Record<string, unknown>
): Promise<ApiOrder> {
  const response = await api.patch<{ data: ApiOrder }>(
    `/api/orders/${orderId}`,
    body
  );
  return response.data;
}

export async function setOrderPaymentSchedule(
  orderId: string,
  schedule: {
    depositPercent: number;
    depositDueDate: string;
    balanceDueDate: string;
  }
): Promise<ApiOrder> {
  const response = await api.patch<{ data: ApiOrder }>(
    `/api/orders/${orderId}/payment-schedule`,
    schedule
  );
  return response.data;
}
