"use client";
import { useEffect, useMemo, useState } from "react";
import { command, usePoll } from "../api";
import { Offline } from "../parts";
import { Card, Empty, reply, toast } from "../ui";

type Link = { url: string; name: string; desc: string; group: string };
type Meta = { id: string; type: string; title: string; topic: string; tags: string[]; created: string; summary: string; status: string; links: Link[]; preview: string; size: number };
type Full = Meta & { body: string };
const TYPES: Record<string, string> = { links: "🔗 منابع", writing: "✍️ نوشته", idea: "💡 ایده", article: "📄 مطلب", raw: "📝 خام" };

export default function NotebookPage() {
  const { data, down, reload } = usePoll<{ notes: Meta[] }>("/api/panel/notebook", 15000);
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [topic, setTopic] = useState("all");
  const [view, setView] = useState<"notes" | "links">("notes");
  const [open, setOpen] = useState<Full | null>(null);
  const [edit, setEdit] = useState<Full | null>(null);
  const [draft, setDraft] = useState("");

  const notes = data?.notes ?? [];
  const topics = useMemo(() => [...new Set(notes.map((n) => n.topic).filter(Boolean))].sort(), [notes]);
  const s = q.trim().toLowerCase();
  const shown = notes.filter(
    (n) => (type === "all" || n.type === type) && (topic === "all" || n.topic === topic) &&
      (!s || `${n.title} ${n.topic} ${n.tags.join(" ")} ${n.summary} ${n.preview} ${n.links.map((l) => l.name + l.url).join(" ")}`.toLowerCase().includes(s)),
  );
  const links = useMemo(() => {
    const by = new Map<string, Link & { topic: string }>();
    for (const n of shown) for (const l of n.links) { const k = l.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""); if (!by.has(k)) by.set(k, { ...l, topic: n.topic }); }
    const groups = new Map<string, Array<Link & { topic: string }>>();
    for (const l of by.values()) { const g = `${l.topic || "—"} › ${l.group || "سایر"}`; groups.set(g, [...(groups.get(g) ?? []), l]); }
    return [...groups].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  async function load(id: string) {
    const r = await command("nb", `json ${id}`);
    try { setOpen(JSON.parse(r.reply ?? "{}")); setEdit(null); } catch { toast("باز نشد"); }
  }
  async function save() {
    if (!edit) return;
    const r = await command("nb", `write ${edit.id}\n${JSON.stringify({ title: edit.title, topic: edit.topic, type: edit.type, tags: edit.tags, body: edit.body })}`);
    reply(r);
    await load(edit.id);
    reload();
  }
  useEffect(() => { if (open && !notes.some((n) => n.id === open.id)) setOpen(null); }, [notes, open]);

  if (down && !data) return <Offline />;
  return (
    <>
      <h1 className="page-h">📒 دفترچه</h1>
      <div className="grid">
        <Card title="➕ یادداشت جدید (یا در تلگرام فوروارد کن)" wide>
          <form className="ask" onSubmit={async (e) => { e.preventDefault(); if (!draft.trim()) return; reply(await command("nb", `save ${draft.trim()}`)); setDraft(""); setTimeout(reload, 1500); }}>
            <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="هر متنی: نوشته‌ی خودت، ایده، لیست سایت‌ها…" aria-label="یادداشت جدید" />
            <button className="primary" disabled={!draft.trim()}>ذخیره</button>
          </form>
        </Card>
      </div>
      <div className="toolbar" style={{ marginTop: 16 }}>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={view === "notes"} className={view === "notes" ? "on" : ""} onClick={() => setView("notes")}>یادداشت‌ها ({notes.length})</button>
          <button role="tab" aria-selected={view === "links"} className={view === "links" ? "on" : ""} onClick={() => setView("links")}>همه‌ی لینک‌ها</button>
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="نوع">
          <option value="all">همه‌ی نوع‌ها</option>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="موضوع">
          <option value="all">همه‌ی موضوع‌ها</option>
          {topics.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="search" placeholder="جستجو…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جستجو" />
      </div>

      {view === "links" ? (
        <Card title={`${links.reduce((a, [, xs]) => a + xs.length, 0)} لینک`} wide>
          {!links.length ? <Empty>لینکی نیست.</Empty> : links.map(([g, xs]) => (
            <div key={g} className="lgroup">
              <h3>{g}</h3>
              {xs.map((l) => (
                <a key={l.url} className="lrow" href={l.url} target="_blank" rel="noreferrer noopener">
                  <b>{l.name || l.url}</b><small className="mute">{l.desc}</small><small className="url" dir="ltr">{l.url.replace(/^https?:\/\//, "")}</small>
                </a>
              ))}
            </div>
          ))}
        </Card>
      ) : (
        <div className="nb">
          <Card title={`${shown.length} یادداشت`}>
            {!data ? <Empty>…</Empty> : !shown.length ? <Empty>چیزی نیست.</Empty> : shown.map((n) => (
              <button key={n.id} className={`nrow${open?.id === n.id ? " on" : ""}`} onClick={() => load(n.id)}>
                <span className="ttl">{TYPES[n.type]?.split(" ")[0]} {n.title || "(بی‌عنوان)"}</span>
                <small className="mute">{n.topic || "—"} · {n.created.slice(0, 10)}{n.links.length ? ` · ${n.links.length} لینک` : ""}{n.status === "pending" ? " · ⏳" : ""}</small>
              </button>
            ))}
          </Card>
          <Card title={open ? (edit ? "✏️ ویرایش" : open.title) : "یک یادداشت را انتخاب کن"}
            action={open && (edit
              ? <span className="acts"><button className="primary" onClick={save}>ذخیره</button><button onClick={() => setEdit(null)}>انصراف</button></span>
              : <span className="acts"><button onClick={() => setEdit({ ...open })}>ویرایش</button><button className="danger" onClick={async () => { if (confirm("به سطل دفترچه برود؟ (برگشت‌پذیر)")) { reply(await command("nb", `del ${open.id}`)); setOpen(null); reload(); } }}>حذف</button></span>)}>
            {!open ? <Empty>از لیست یکی را باز کن.</Empty> : edit ? (
              <div className="editor">
                <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} aria-label="عنوان" />
                <div className="ask">
                  <select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })} aria-label="نوع">{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  <input value={edit.topic} onChange={(e) => setEdit({ ...edit, topic: e.target.value })} placeholder="موضوع" aria-label="موضوع" />
                  <input value={edit.tags.join("، ")} onChange={(e) => setEdit({ ...edit, tags: e.target.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean) })} placeholder="برچسب‌ها" aria-label="برچسب‌ها" />
                </div>
                <textarea rows={18} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} aria-label="متن" />
              </div>
            ) : (
              <div className="reader">
                <small className="mute">{TYPES[open.type]} · {open.topic || "—"} · {open.created.replace("T", " ")}{open.tags.length ? ` · #${open.tags.join(" #")}` : ""}</small>
                {open.summary && <p className="sum">{open.summary}</p>}
                <pre>{open.body}</pre>
                {open.links.length > 0 && (
                  <div className="lgroup"><h3>لینک‌ها</h3>{open.links.map((l) => (
                    <a key={l.url} className="lrow" href={l.url} target="_blank" rel="noreferrer noopener"><b>{l.name}</b><small className="mute">{l.group} · {l.desc}</small></a>
                  ))}</div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
