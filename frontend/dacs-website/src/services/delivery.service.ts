// TODO: Connect to the DACS backend API
import {
  readUserStorage,
  USER_STORAGE_KEYS,
  writeUserStorage,
} from "@/lib/storage/local-storage";

/**
 * Delivery details the customer chose to keep for future checkouts. Stored
 * per authenticated user (dacs.delivery.<userId>) — never shared across
 * accounts, and only ever written after a successful order placed with
 * "Save this delivery information" checked. Payment details are never
 * stored here.
 */
export interface SavedDeliveryInformation {
  fullName: string;
  contactNumber: string;
  email: string;
  deliveryAddress: string;
  updatedAt: string;
}

export function getSavedDelivery(): SavedDeliveryInformation | null {
  return readUserStorage<SavedDeliveryInformation | null>(
    USER_STORAGE_KEYS.delivery,
    null
  );
}

export function saveDelivery(
  information: Omit<SavedDeliveryInformation, "updatedAt">
): void {
  writeUserStorage(USER_STORAGE_KEYS.delivery, {
    ...information,
    updatedAt: new Date().toISOString(),
  });
}
