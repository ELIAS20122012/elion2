"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { post, usePoll, type Appointment, type Lab, type Overview } from "./api";
import { Graph, type GLink, type GNode } from "./Graph";
import { Offline } from "./parts";
import { reply } from "./ui";

type Mod = { key: string; href: string; icon: string; n: number | string; label: string; sub: string; color: string; on: boolean };

const fa = (n: number) => n.toLocaleString("fa-IR");

export default function Home() {
  const { data, down } = usePoll<Overview>("/api/overview", 4000);
  const appts = usePoll<{ upcoming: Appointment[] }>("/api/panel/appointments", 30000).data;
  const memory = usePoll<{ notes: string[] }>("/api/panel/memory", 30000).data;
  const lab = usePoll<Lab>("/api/panel/lab", 30000).data;
  const notebook = usePoll<{ notes: { id: string; title: string; topic: string }[] }>("/api/panel/notebook", 30000).data;
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<{ id: string; q: string } | null>(null);
  const graph = useMemo(() => buildGraph(data, appts?.upcoming ?? [], memory?.notes ?? [], lab, notebook?.notes ?? []), [data, appts, memory, lab, notebook]);

  if (down && !data) return <Offline />;
  const s = data?.stats ?? {};
  const live = (s.running ?? 0) + (s.queued ?? 0) + (s.verifying ?? 0);
  const ready = data?.providers.filter((p) => !p.coolingUntil).length ?? 0;
  const cooling = (data?.providers.length ?? 0) - ready;
  const labRuns = lab ? Object.values(lab.stats).reduce((a, x) => a + x.runs, 0) : 0;
  const labWins = lab ? Object.values(lab.stats).reduce((a, x) => a + x.wins, 0) : 0;
  const next = appts?.upcoming[0];
  const sched = data?.schedules.filter((x) => x.enabled) ?? [];
  const mods: Mod[] = [
    { key: "agents", href: "/lab", icon: "⚇", n: ready, label: "ایجنت‌ها", sub: `${fa(ready)} آماده · ${fa(cooling)} محدود`, color: "#38bdf8", on: ready > 0 },
    { key: "tasks", href: "/tasks", icon: "☰", n: live, label: "کارها", sub: live ? "در حال انجام" : `${fa(s.succeeded ?? 0)} انجام‌شده`, color: "#a78bfa", on: true },
    { key: "calendar", href: "/calendar", icon: "▦", n: appts?.upcoming.length ?? "—", label: "ترمین‌ها", sub: next ? `${next.text}`.slice(0, 22) : "ترمینی نیست", color: "#f59e0b", on: true },
    { key: "memory", href: "/memory", icon: "◎", n: memory?.notes.length ?? "—", label: "حافظه", sub: "یادداشت ماندگار", color: "#c084fc", on: true },
    { key: "skills", href: "/system", icon: "✦", n: (data?.skills.length ?? 0) + (data?.commands.length ?? 0), label: "اسکیل‌ها", sub: `${fa(data?.commands.length ?? 0)} دستور`, color: "#22d3ee", on: true },
    { key: "lab", href: "/lab", icon: "⚗", n: labRuns, label: "آزمایشگاه", sub: `${fa(labWins)} برد ثبت‌شده`, color: "#f472b6", on: lab?.routing ?? false },
    { key: "schedules", href: "/system", icon: "◷", n: sched.length, label: "زمان‌بندی", sub: "کار خودکار", color: "#34d399", on: sched.length > 0 },
    { key: "approvals", href: "/", icon: "⚑", n: data?.approvals.length ?? 0, label: "تأییدها", sub: data?.approvals.length ? "منتظر تو" : "چیزی منتظر نیست", color: "#fb7185", on: true },
  ];

  async function ask() {
    const q = text.trim();
    if (!q) return;
    const r = await post("/api/tasks", { prompt: q });
    if (r.ok && r.id) {
      setAsked({ id: r.id, q });
      setText("");
    } else reply(r);
  }

  return (
    <>
      {data && data.approvals.length > 0 && (
        <div className="approvals">
          {data.approvals.map((a) => (
            <div className="appr" key={a.id}>
              <span className="t">
                <b>⚑ {a.task}</b>
                <small>{a.reason || a.capability}</small>
              </span>
              <button className="primary" onClick={async () => reply(await post(`/api/approvals/${a.id}/approve`))}>تأیید</button>
              <button onClick={async () => reply(await post(`/api/approvals/${a.id}/reject`))}>رد</button>
            </div>
          ))}
        </div>
      )}
      <section className="stage">
        <div className="states" dir="ltr" aria-label="وضعیت">
          {(["idle", "thinking", "working"] as const).map((x) => (
            <span key={x} className={(x === "idle" && !live) || (x === "working" && live > 0) || (x === "thinking" && (s.verifying ?? 0) > 0) ? "on" : ""}>{x}</span>
          ))}
        </div>
        <Graph nodes={graph.nodes} links={graph.links} busy={live > 0} />
        <div className="core">
          <small>{live ? `روی ${fa(live)} کار کار می‌کنم…` : "آنلاینم. چه کاری انجام بدهم؟"}</small>
        </div>
        <div className="mods">
          {mods.map((m) => (
            <Link href={m.href} key={m.key} className={`mod m-${m.key}`} style={{ ["--c" as string]: m.color }}>
              <span className="mod-h">
                <span className="mic" aria-hidden>{m.icon}</span>
                <span className={`live${m.on ? "" : " off"}`}>{m.on ? "online" : "off"}</span>
              </span>
              <b className="num">{typeof m.n === "number" ? m.n : m.n}</b>
              <span className="lbl">{m.label}</span>
              <small>{m.sub}</small>
              <i className="bar" />
            </Link>
          ))}
        </div>
        <div className="askbox">
          {asked && <Answer id={asked.id} q={asked.q} data={data} onClose={() => setAsked(null)} />}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="از Elion هر چیزی بپرس…" aria-label="درخواست" />
            <button className="send" disabled={!text.trim()} aria-label="ارسال">➤</button>
          </form>
        </div>
      </section>
    </>
  );
}

function Answer({ id, q, data, onClose }: { id: string; q: string; data: Overview | null; onClose: () => void }) {
  const t = data?.tasks.find((x) => x.id === id);
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const i = setInterval(() => setDots((d) => (d % 3) + 1), 500);
    return () => clearInterval(i);
  }, []);
  const done = t && (t.status === "succeeded" || t.status === "failed" || t.status === "cancelled");
  const body = t?.result?.replace(/^>>> .*$/gm, "").replace(/<<<(PHOTO|FILE) .*? (PHOTO|FILE)>>>/g, "📎").trim();
  return (
    <div className="answer" role="status">
      <button className="x" onClick={onClose} aria-label="بستن">×</button>
      <small className="q">{q}</small>
      {done ? <p className={t.status === "succeeded" ? "" : "bad"}>{body || t.error || "—"}</p> : <p className="mute">در حال فکر کردن{".".repeat(dots)}</p>}
    </div>
  );
}

/** Everything Elion knows, as one graph: core → modules → their items. */
function buildGraph(d: Overview | null, appts: Appointment[], notes: string[], lab: Lab | null, book: { id: string; title: string; topic: string }[] = []): { nodes: GNode[]; links: GLink[] } {
  const nodes: GNode[] = [{ id: "core", label: "ELION", group: "core" }];
  const links: GLink[] = [];
  const hub = (group: string, label: string, href: string, items: { id: string; label: string }[]) => {
    const id = `hub:${group}`;
    nodes.push({ id, label, group, hub: true, href });
    links.push({ a: "core", b: id });
    for (const it of items) {
      nodes.push({ id: `${group}:${it.id}`, label: it.label, group });
      links.push({ a: id, b: `${group}:${it.id}` });
    }
  };
  if (!d) return { nodes, links };
  hub("agents", "ایجنت‌ها", "/lab", d.providers.map((p) => ({ id: p.name, label: p.name })));
  hub("tasks", "کارها", "/tasks", d.tasks.slice(0, 14).map((t) => ({ id: t.id, label: t.title })));
  hub("calendar", "ترمین‌ها", "/calendar", appts.map((a) => ({ id: a.id, label: `${a.date.split("-").reverse().join(".")} · ${a.text}` })));
  hub("memory", "حافظه", "/memory", notes.map((n, i) => ({ id: String(i), label: n.replace(/ ⟨auto [\d-]+⟩$/, "") })));
  const cmds = new Set(d.commands.map((c) => c.name));
  hub("skills", "اسکیل‌ها", "/system", [...d.commands, ...d.skills.filter((x) => !cmds.has(x.name))].map((c) => ({ id: c.name, label: `/${c.name}` })));
  hub("lab", "آزمایشگاه", "/lab", (lab?.models ?? []).map((m) => ({ id: m.name, label: m.label })));
  hub("schedules", "زمان‌بندی", "/system", d.schedules.filter((x) => x.enabled).map((x) => ({ id: x.name, label: x.name })));
  if (book.length) hub("notebook", "دفترچه", "/notebook", book.slice(0, 40).map((n) => ({ id: n.id, label: n.title })));
  if (d.approvals.length) hub("approvals", "تأییدها", "/", d.approvals.map((a) => ({ id: a.id, label: a.task })));
  // cross links: lab models are also agents
  for (const m of lab?.models ?? []) if (d.providers.some((p) => p.name === m.name)) links.push({ a: `lab:${m.name}`, b: `agents:${m.name}` });
  return { nodes, links };
}
