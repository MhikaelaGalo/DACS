"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import * as cartService from "@/services/cart.service";
import type { CartItem, Product } from "@/types/product";

interface CartContextValue {
  items: CartItem[];
  count: number;
  subtotal: number;
  addItem: (product: Product, quantity: number) => void;
  /** Adds one seminar module's access (quantity fixed at 1, no duplicates). */
  addSeminarItem: (seminar: cartService.SeminarCartInput) => void;
  /** Whether the cart already holds this line (product or module UUID). */
  hasItem: (id: string) => boolean;
  updateQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const userId = user?.id ?? null;
  const [items, setItems] = useState<CartItem[]>([]);

  // The cart is per-account: rehydrate whenever the session changes so a
  // sign-out or account switch drops the previous user's in-memory items.
  useEffect(() => {
    if (!ready) return;
    setItems(userId ? cartService.getCart() : []);
  }, [ready, userId]);

  const addItem = useCallback((product: Product, quantity: number) => {
    setItems(cartService.addToCart(product, quantity));
  }, []);

  const addSeminarItem = useCallback(
    (seminar: cartService.SeminarCartInput) => {
      setItems(cartService.addSeminarToCart(seminar));
    },
    []
  );

  const hasItem = useCallback(
    (id: string) => items.some((item) => item.productId === id),
    [items]
  );

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    setItems(cartService.updateQuantity(productId, quantity));
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems(cartService.removeFromCart(productId));
  }, []);

  const clear = useCallback(() => {
    cartService.clearCart();
    setItems([]);
  }, []);

  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        count,
        subtotal,
        addItem,
        addSeminarItem,
        hasItem,
        updateQuantity,
        removeItem,
        clear,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
