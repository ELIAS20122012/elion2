"use client";
import { useEffect, useState, type ReactNode } from "react";

export function Card({ title, action, children, wide }: { title: string; action?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`card${wide ? " wide" : ""}`}>
      <header className="card-h">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** Bottom toast for command replies and errors. */
let push: (m: string) => void = () => {};
export function toast(m: string) {
  push(m);
}
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    push = (m) => {
      setMsg(m);
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), Math.min(9000, 2500 + m.length * 40));
    };
    return () => clearTimeout(t);
  }, []);
  return msg ? (
    <div className="toast" role="status" onClick={() => setMsg(null)}>
      {msg}
    </div>
  ) : null;
}

export function reply(r: { ok?: boolean; reply?: string; error?: string }) {
  toast(r.error ? `خطا: ${r.error}` : r.reply ?? "✔ انجام شد");
}
