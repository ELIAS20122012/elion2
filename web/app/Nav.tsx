"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePoll, type Overview } from "./api";

const LINKS = [
  { href: "/", icon: "◈", label: "داشبورد" },
  { href: "/tasks", icon: "☰", label: "کارها" },
  { href: "/calendar", icon: "▦", label: "ترمین‌ها" },
  { href: "/memory", icon: "◎", label: "حافظه" },
  { href: "/lab", icon: "⚗", label: "آزمایشگاه" },
  { href: "/system", icon: "⚙", label: "سیستم" },
];

export function Nav() {
  const path = usePathname().replace(/\/$/, "") || "/";
  const { data, down } = usePoll<Overview>("/api/overview", 10000);
  const alive = !down && !!data?.heartbeat && Date.now() - new Date(data.heartbeat).getTime() < 90_000;
  const pending = data?.approvals.length ?? 0;
  return (
    <nav className="nav" aria-label="بخش‌ها">
      <div className="brand">
        <span className="logo" aria-hidden>⬡</span>
        <b>ELIAS OS</b>
        <small>v1</small>
      </div>
      <div className="links">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""} aria-current={path === l.href ? "page" : undefined}>
            <span className="ic" aria-hidden>{l.icon}</span>
            <span className="lb">{l.label}</span>
            {l.href === "/" && pending > 0 && <span className="badge">{pending.toLocaleString("fa-IR")}</span>}
          </Link>
        ))}
      </div>
      <div className="me">
        <span className="avatar">EF</span>
        <span className="t">
          <b>Elias Farahani</b>
          <small className={alive ? "ok" : "bad"}>{alive ? "● سیستم روشن" : "● قطع"}</small>
        </span>
      </div>
    </nav>
  );
}
