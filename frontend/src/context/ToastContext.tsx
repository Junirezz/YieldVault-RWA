import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Toaster, toast as sonnerToast } from "sonner";
import { getToastDedupeKey } from "../lib/toastDedupe";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastOptions {
  title: string;
  description?: string;
  duration?: number;
  variant?: ToastVariant;
  /** Unique key for deduplication. If not provided, deduplication uses title+description+variant */
  dedupeKey?: string;
  /**
   * Transaction hash for notifications produced by polling or event updates.
   * All updates for one hash share a single toast.
   */
  transactionHash?: string;
  /** Current transaction status; changing it updates the existing toast in place. */
  status?: string;
}

export interface ToastItem extends ToastOptions {
  id: string;
  variant: ToastVariant;
  duration: number;
  timestamp: number;
}

interface ToastContextType {
  showToast: (options: ToastOptions) => string;
  dismissToast: (id: string) => void;
  success: (options: Omit<ToastOptions, "variant">) => string;
  error: (options: Omit<ToastOptions, "variant">) => string;
  warning: (options: Omit<ToastOptions, "variant">) => string;
  info: (options: Omit<ToastOptions, "variant">) => string;
  clearAll: () => void;
  toasts: ToastItem[];
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const DEFAULT_DURATION = 5000;
const DEDUPE_WINDOW_MS = 3000;
const MAX_QUEUE = 5;

function pushSonner(toast: ToastItem) {
  const payload = {
    id: toast.id,
    description: toast.description,
    duration: toast.duration,
    closeButton: true,
  };
  switch (toast.variant) {
    case "success":
      sonnerToast.success(toast.title, payload);
      break;
    case "error":
      sonnerToast.error(toast.title, payload);
      break;
    case "warning":
      sonnerToast.warning(toast.title, payload);
      break;
    default:
      sonnerToast.info(toast.title, payload);
  }
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextToastId = useRef(0);
  const timeoutRefs = useRef<Map<string, number>>(new Map());
  const recentToasts = useRef<Map<string, string>>(new Map());
  const activeToasts = useRef<Map<string, ToastItem>>(new Map());
  const [sonnerTheme, setSonnerTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => {
      setSonnerTheme(root.getAttribute("data-theme") === "light" ? "light" : "dark");
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const dismissToast = (id: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
    activeToasts.current.delete(id);
    const timeoutId = timeoutRefs.current.get(id);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutRefs.current.delete(id);
    }
    sonnerToast.dismiss(id);
  };

  const clearAll = () => {
    setToasts([]);
    activeToasts.current.clear();
    timeoutRefs.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    timeoutRefs.current.clear();
    recentToasts.current.clear();
    sonnerToast.dismiss();
  };

  const showToast = ({
    variant = "info",
    duration = DEFAULT_DURATION,
    ...options
  }: ToastOptions) => {
    const dedupeKey = getToastDedupeKey({ ...options, variant });
    const now = Date.now();

    const existingId = recentToasts.current.get(dedupeKey);
    if (existingId && timeoutRefs.current.has(existingId)) {
      const oldTimeout = timeoutRefs.current.get(existingId);
      if (oldTimeout) window.clearTimeout(oldTimeout);
      const newTimeout = window.setTimeout(() => {
        dismissToast(existingId);
      }, duration);
      timeoutRefs.current.set(existingId, newTimeout);

      // A later poll/event update for the same transaction changes the status
      // of the existing toast instead of stacking another one.
      const previous = activeToasts.current.get(existingId);
      if (previous && options.transactionHash) {
        const updated: ToastItem = {
          ...previous,
          ...options,
          id: existingId,
          variant,
          duration,
          timestamp: now,
        };
        const changed =
          previous.status !== updated.status ||
          previous.title !== updated.title ||
          previous.description !== updated.description ||
          previous.variant !== updated.variant;
        if (changed) {
          activeToasts.current.set(existingId, updated);
          setToasts((currentToasts) =>
            currentToasts.map((item) => (item.id === existingId ? updated : item)),
          );
          pushSonner(updated);
        }
      }
      return existingId;
    }

    nextToastId.current += 1;
    const id = `toast-${nextToastId.current}`;
    const nextToast: ToastItem = {
      id,
      variant,
      duration,
      timestamp: now,
      ...options,
    };

    setToasts((currentToasts) => {
      const queued = [...currentToasts, nextToast];
      if (queued.length <= MAX_QUEUE) {
        return queued;
      }
      const dropped = queued.slice(0, queued.length - MAX_QUEUE);
      dropped.forEach((toast) => {
        activeToasts.current.delete(toast.id);
        const timeoutId = timeoutRefs.current.get(toast.id);
        if (timeoutId) {
          window.clearTimeout(timeoutId);
          timeoutRefs.current.delete(toast.id);
        }
        sonnerToast.dismiss(toast.id);
      });
      return queued.slice(-MAX_QUEUE);
    });
    recentToasts.current.set(dedupeKey, id);
    activeToasts.current.set(id, nextToast);
    pushSonner(nextToast);

    const timeoutId = window.setTimeout(() => {
      dismissToast(id);
    }, duration);

    timeoutRefs.current.set(id, timeoutId);
    return id;
  };

  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const staleKeys: string[] = [];
      recentToasts.current.forEach((toastId, key) => {
        if (!timeoutRefs.current.has(toastId)) {
          staleKeys.push(key);
        }
      });
      staleKeys.forEach((key) => recentToasts.current.delete(key));
    }, DEDUPE_WINDOW_MS);
    return () => clearInterval(cleanupInterval);
  }, []);

  useEffect(() => {
    const timeouts = timeoutRefs.current;
    return () => {
      timeouts.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      timeouts.clear();
    };
  }, []);

  return (
    <ToastContext.Provider
      value={{
        showToast,
        dismissToast,
        clearAll,
        success: (options) => showToast({ ...options, variant: "success" }),
        error: (options) => showToast({ ...options, variant: "error" }),
        warning: (options) => showToast({ ...options, variant: "warning" }),
        info: (options) => showToast({ ...options, variant: "info" }),
        toasts,
      }}
    >
      {children}
      <Toaster
        theme={sonnerTheme}
        position="top-right"
        closeButton
        richColors
        visibleToasts={MAX_QUEUE}
        toastOptions={{
          duration: DEFAULT_DURATION,
          classNames: {
            toast: "yv-sonner-toast",
            closeButton: "yv-sonner-close",
          },
        }}
      />
    </ToastContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }

  return context;
}

/** Alias matching the notification-context acceptance criteria. */
export const NotificationProvider = ToastProvider;
// eslint-disable-next-line react-refresh/only-export-components
export const useNotification = useToast;
