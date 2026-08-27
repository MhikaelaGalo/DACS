/*
 * Payments (staff read side). Mirrors back end/src/modules/payments.
 */
import { api } from "../api";

export interface ApiPayment {
  id: string;
  orderId: string;
  customerProfileId: string;
  paymentType: "DEPOSIT" | "BALANCE" | "FULL" | "SHIPPING_FEE" | "PROCESSING_FEE";
  /* Prisma Decimal — serialized as a string. */
  amount: string;
  paymentDate: string | null;
  referenceNumber: string | null;
  status: "SUBMITTED" | "VERIFIED" | "REJECTED";
  /* HISTORICAL_IMPORT rows are legacy summaries with no proof file. */
  source: "LIVE" | "HISTORICAL_IMPORT";
  proofOriginalName: string | null;
  proofStorageUrl: string | null;
  verifiedAt: string | null;
  createdAt: string;
  order?: {
    id: string;
    orderNumber: string;
    orderType: string;
    status: string;
    totalAmount: string;
  };
}

export async function listPayments(
  status?: "SUBMITTED" | "VERIFIED" | "REJECTED"
): Promise<ApiPayment[]> {
  const response = await api.get<{ data: ApiPayment[] }>("/api/payments", {
    status,
  });
  return response.data;
}

export interface RecordPaymentBody {
  paymentType: ApiPayment["paymentType"];
  amount: number;
  paymentDate?: string;
  referenceNumber?: string;
  notes?: string;
}

/*
 * Customers email their proof of payment to DACS; staff enter it here.
 * The backend stores the payment as VERIFIED (no proof file), moves the
 * order along the payment statuses, and — because a payment row now
 * exists — excludes the order from the 14-day auto-cancel sweep.
 */
export async function recordOrderPayment(
  orderId: string,
  body: RecordPaymentBody
): Promise<{
  data: ApiPayment;
  verifiedTotal: string;
  orderStatusUpdated: boolean;
}> {
  return api.post<{
    data: ApiPayment;
    verifiedTotal: string;
    orderStatusUpdated: boolean;
  }>(`/api/payments/orders/${orderId}/record`, body);
}
