// TODO: Connect to the DACS backend API
import {
  readUserStorage,
  USER_STORAGE_KEYS,
  writeUserStorage,
} from "@/lib/storage/local-storage";
import { isSeminarCartItem, type CartItem, type Product } from "@/types/product";

// The cart is stored per authenticated user; signed out it reads empty and
// writes are dropped (adding to cart already requires signing in first).
export function getCart(): CartItem[] {
  return readUserStorage<CartItem[]>(USER_STORAGE_KEYS.cart, []);
}

export function saveCart(items: CartItem[]): void {
  writeUserStorage(USER_STORAGE_KEYS.cart, items);
}

export function addToCart(product: Product, quantity: number): CartItem[] {
  const items = getCart();
  const existing = items.find((i) => i.productId === product.id);
  const next = existing
    ? items.map((i) =>
        i.productId === product.id
          ? { ...i, quantity: i.quantity + quantity }
          : i
      )
    : [
        ...items,
        {
          productId: product.id,
          name: product.name,
          category: product.category,
          price: product.price,
          unit: product.unit,
          imageUrl: product.imageUrl,
          quantity,
        },
      ];
  saveCart(next);
  return next;
}

/** What addSeminarToCart needs to build a seminar-access cart line. */
export interface SeminarCartInput {
  /** Backend seminar module UUID. */
  moduleId: string;
  title: string;
  price: number;
  imageUrl: string | null;
}

/**
 * Adds one seminar module's access to the cart. Always quantity 1 —
 * adding the same module again is a no-op, never a second unit (access
 * cannot be purchased twice).
 */
export function addSeminarToCart(seminar: SeminarCartInput): CartItem[] {
  const items = getCart();
  if (items.some((i) => i.productId === seminar.moduleId)) return items;
  const next: CartItem[] = [
    ...items,
    {
      productId: seminar.moduleId,
      seminarModuleId: seminar.moduleId,
      itemType: "SEMINAR",
      name: seminar.title,
      category: "SEMINAR",
      price: seminar.price,
      unit: "",
      imageUrl: seminar.imageUrl ?? "",
      quantity: 1,
    },
  ];
  saveCart(next);
  return next;
}

export function updateQuantity(productId: string, quantity: number): CartItem[] {
  const next = getCart()
    // Seminar lines are pinned at quantity 1 (a 0 still removes them).
    .map((i) =>
      i.productId === productId
        ? { ...i, quantity: isSeminarCartItem(i) && quantity > 0 ? 1 : quantity }
        : i
    )
    .filter((i) => i.quantity > 0);
  saveCart(next);
  return next;
}

export function removeFromCart(productId: string): CartItem[] {
  const next = getCart().filter((i) => i.productId !== productId);
  saveCart(next);
  return next;
}

export function clearCart(): void {
  saveCart([]);
}
