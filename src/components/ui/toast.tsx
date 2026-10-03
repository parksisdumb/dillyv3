"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/styles";

type Toast = { id: number; text: string; tone: "good" | "bad" | "neutral" };
type Ctx = { toast: (text: string, tone?: Toast["tone"]) => void };

const ToastCtx = createContext<Ctx>({ toast: () => {} });

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const toast = useCallback((text: string, tone: Toast["tone"] = "good") => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-2), { id, text, tone }]);
  }, []);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+148px)] z-50 flex flex-col items-center gap-2 px-4"
      >
        {items.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const h = setTimeout(onDone, toast.tone === "bad" ? 7000 : 4500);
    return () => clearTimeout(h);
  }, [onDone, toast.tone]);
  return (
    <button
      type="button"
      onClick={onDone}
      className={cn(
        "pointer-events-auto num w-full max-w-md rounded-lg px-4 py-3 text-left font-display text-base font-semibold shadow-lg",
        toast.tone === "good" && "bg-ink text-ground",
        toast.tone === "neutral" && "bg-ink text-ground",
        toast.tone === "bad" && "bg-danger text-white",
      )}
    >
      {toast.text}
    </button>
  );
}
