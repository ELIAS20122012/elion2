import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface ToastItem { id: number; kind: "ok" | "err"; text: string }
interface ToastApi { ok: (text: string) => void; err: (text: string) => void }

const Ctx = createContext<ToastApi | null>(null);

/** Short, self-dismissing feedback for actions (sync finished, import failed, ...). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((kind: ToastItem["kind"], text: string) => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), kind === "err" ? 7000 : 4000);
  }, []);

  const api = useMemo<ToastApi>(() => ({ ok: (t) => push("ok", t), err: (t) => push("err", t) }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}
