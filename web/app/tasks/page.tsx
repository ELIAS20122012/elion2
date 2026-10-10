"use client";
import { useMemo, useState } from "react";
import { FA, usePoll, type Overview, type Status } from "../api";
import { Offline } from "../parts";
import { TaskRow } from "../TaskRow";
import { Card, Empty } from "../ui";

const FILTERS: (Status | "all" | "live")[] = ["all", "live", "succeeded", "failed"];
const LABEL: Record<string, string> = { all: "همه", live: "در جریان", succeeded: FA.succeeded, failed: FA.failed };

export default function Tasks() {
  const { data, down } = usePoll<Overview>("/api/overview", 4000);
  const [f, setF] = useState<(typeof FILTERS)[number]>("all");
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.tasks ?? []).filter((t) => {
      if (f === "live" && !["queued", "running", "verifying", "awaiting_approval"].includes(t.status)) return false;
      if (f !== "all" && f !== "live" && t.status !== f) return false;
      return !s || t.title.toLowerCase().includes(s) || t.provider.includes(s) || t.source.includes(s);
    });
  }, [data, f, q]);
  if (down && !data) return <Offline />;
  return (
    <>
      <h1 className="page-h">📋 کارها</h1>
      <div className="toolbar">
        <div className="seg" role="tablist">
          {FILTERS.map((x) => (
            <button key={x} role="tab" aria-selected={f === x} className={f === x ? "on" : ""} onClick={() => setF(x)}>
              {LABEL[x]}
            </button>
          ))}
        </div>
        <input type="search" placeholder="جستجو…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جستجو" />
      </div>
      <Card title={`${rows.length.toLocaleString("fa-IR")} کار (۳۰ کار آخر)`} wide>
        {!data ? <Empty>…</Empty> : rows.length ? rows.map((t) => <TaskRow key={t.id} t={t} />) : <Empty>چیزی پیدا نشد.</Empty>}
      </Card>
    </>
  );
}
