"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

/*
 * Lightweight toast feedback (success/error) so destructive and save
 * actions never fail silently. Integration keeps this component — only
 * the callers' data operations change.
 */

type ToastTone = "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const showToast = useCallback((message: string, tone: ToastTone = "success") => {
    counter.current += 1;
    const id = counter.current;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-[70] flex flex-col items-center gap-2 sm:bottom-6 sm:left-auto sm:right-6 sm:items-end">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            className={`pointer-events-auto flex max-w-full items-center gap-2.5 rounded-2xl px-5 py-3.5 text-sm font-semibold text-white shadow-dacs-card ${
              toast.tone === "error" ? "bg-dacs-red" : "bg-dacs-dark"
            }`}
          >
            {toast.tone === "error" ? (
              <AlertCircle size={18} className="shrink-0" />
            ) : (
              <CheckCircle2 size={18} className="shrink-0" />
            )}
            <span className="min-w-0 break-words">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
