import { createContext, useCallback, useContext, useMemo, useState } from "react";

interface ToastItem {
  id: number;
  message: string;
  kind: "good" | "bad" | "neutral";
}

interface ToastContextValue {
  notify: (message: string, kind?: ToastItem["kind"]) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * A cross-cutting concern (anything, anywhere, can report success/failure)
 * is the one case in this app where prop-drilling would be worse than a
 * small context — everything else here stays local state on purpose.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const notify = useCallback((message: string, kind: ToastItem["kind"] = "neutral") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" role="status">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "neutral" ? "" : t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
