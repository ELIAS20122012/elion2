"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePoll, type Overview } from "./api";

const LINKS = [
  { href: "/", icon: "🏠", label: "خانه" },
  { href: "/tasks", icon: "📋", label: "کارها" },
  { href: "/calendar", icon: "📅", label: "ترمین‌ها" },
  { href: "/memory", icon: "🧠", label: "حافظه" },
  { href: "/lab", icon: "🧪", label: "آزمایشگاه" },
  { href: "/system", icon: "⚙️", label: "سیستم" },
];

export function Nav() {
  const path = usePathname().replace(/\/$/, "") || "/";
  const { data, down } = usePoll<Overview>("/api/overview", 10000);
  const alive = !down && !!data?.heartbeat && Date.now() - new Date(data.heartbeat).getTime() < 90_000;
  const pending = data?.approvals.length ?? 0;
  return (
    <nav className="nav" aria-label="بخش‌ها">
      <div className="brand">
        <span className={`dot ${alive ? "on" : "off"}`} title={alive ? "روشن" : "خاموش / قطع"} />
        Elias OS
      </div>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""} aria-current={path === l.href ? "page" : undefined}>
          <span className="ic" aria-hidden>{l.icon}</span>
          <span className="lb">{l.label}</span>
          {l.href === "/" && pending > 0 && <span className="badge">{pending.toLocaleString("fa-IR")}</span>}
        </Link>
      ))}
    </nav>
  );
}
