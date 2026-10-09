import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { onDataSource, type DataSource } from "../lib/journalApi";
import { useAuth } from "../lib/session";

/** "۴ دقیقه پیش" — how old the mirrored journal is. */
function ago(seconds: number): string {
  if (seconds < 90) return "چند لحظه پیش";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} دقیقه پیش`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ساعت پیش`;
  return `${Math.round(h / 24)} روز پیش`;
}

/**
 * Says so, quietly, when the page is reading the published mirror instead of the journal server at
 * home — otherwise a balance from last night looks exactly like a balance from this second. Renders
 * nothing when the PC is answering, and nothing at all in local development, where no gateway
 * labels the responses.
 */
export default function ElionMirrorBanner() {
  const [src, setSrc] = useState<DataSource | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { pathname } = useLocation();
  const { user, setup } = useAuth();
  // the welcome screen is the front door, not a view of the data - nothing to caveat there yet
  const atDoor = pathname === "/welcome" || (pathname === "/" && !user && !setup);

  useEffect(() => onDataSource(setSrc), []);
  useEffect(() => {
    if (src?.kind !== "mirror") return;
    const iv = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(iv);
  }, [src?.kind]);

  if (atDoor) return null;
  if (src?.kind !== "mirror" && src?.kind !== "demo") return null;
  const demo = src.kind === "demo";
  const age = src.generatedAt ? Math.max(0, Math.floor(now / 1000) - src.generatedAt) : null;

  return (
    <div
      className="elion-scope"
      role="status"
      style={{
        position: "fixed",
        insetInline: 0,
        bottom: 14,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 60,
      }}
    >
      <div
        style={{
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 14px",
          borderRadius: 999,
          direction: "rtl",
          fontSize: 12,
          color: "#f0d9a8",
          background: "rgba(36,28,12,.94)",
          border: "1px solid rgba(233,215,176,.35)",
          boxShadow: "0 6px 22px rgba(0,0,0,.45)",
          backdropFilter: "blur(6px)",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 999, background: "#e2b23c", flex: "0 0 auto" }} />
        <span>
          {demo ? "داده‌های نمونه — این یک نسخه‌ی نمایشی است، نه یک حساب واقعی" : "حالت نمایش — کامپیوتر خانه خاموش است"}
          {!demo && age != null && <span style={{ opacity: 0.75 }}>{` · آخرین به‌روزرسانی ${ago(age)}`}</span>}
        </span>
      </div>
    </div>
  );
}
