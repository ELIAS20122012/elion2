import { useEffect, useMemo, useState } from "react";
import { INDICATORS, INDICATOR_BY_ID, defaultParams, instanceLabel, type IndicatorInstance } from "../lib/indicators";
import { uid } from "../lib/drawings";
import Icon from "./Icon";

interface Props {
  items: IndicatorInstance[];
  onChange: (items: IndicatorInstance[]) => void;
  volume: boolean;
  hasVolume: boolean;
  onVolume: () => void;
}

export default function IndicatorsBar({ items, onChange, volume, hasVolume, onVolume }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const patch = (u: string, fn: (i: IndicatorInstance) => IndicatorInstance | null) =>
    onChange(items.flatMap((i) => (i.uid === u ? (fn(i) ? [fn(i) as IndicatorInstance] : []) : [i])));

  return (
    <div className="indbar">
      <button className="btn" onClick={() => setOpen(true)}><Icon name="fx" size={16} />اندیکاتورها</button>
      <button className={`btn ${volume && hasVolume ? "active" : ""}`} onClick={onVolume} disabled={!hasVolume} title={hasVolume ? "حجم تیک MT5" : "حجم فقط در حالت زنده MT5 هست"}><Icon name="volume" size={16} />حجم</button>
      {items.map((i) => (
        <div key={i.uid} className={`ichip ${i.visible ? "" : "hidden"}`} dir="ltr">
          <button onClick={() => patch(i.uid, (x) => ({ ...x, visible: !x.visible }))} title={i.visible ? "پنهان" : "نمایش"} aria-label="نمایش/پنهان"><Icon name="eye" size={14} /></button>
          <span className="name" onClick={() => setEditing(editing === i.uid ? null : i.uid)} title="تنظیمات">{instanceLabel(i)}</span>
          <button onClick={() => patch(i.uid, () => null)} title="حذف" aria-label="حذف"><Icon name="x" size={14} /></button>
          {editing === i.uid && (
            <div className="pop" dir="rtl">
              {INDICATOR_BY_ID[i.id].params.map((p) => (
                <label key={p.key}>
                  <span>{p.label}</span>
                  <input
                    type="number"
                    value={i.params[p.key]}
                    step={p.step ?? 1}
                    min={p.min ?? 1}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (Number.isFinite(v) && v >= (p.min ?? 1)) patch(i.uid, (x) => ({ ...x, params: { ...x.params, [p.key]: v } }));
                    }}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
      {open && <Picker onClose={() => setOpen(false)} onAdd={(id) => onChange([...items, { uid: uid(), id, params: defaultParams(INDICATOR_BY_ID[id]), visible: true }])} count={(id) => items.filter((i) => i.id === id).length} />}
    </div>
  );
}

function Picker({ onClose, onAdd, count }: { onClose: () => void; onAdd: (id: string) => void; count: (id: string) => number }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<"all" | "overlay" | "pane">("all");

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const list = useMemo(
    () => INDICATORS.filter((d) => (group === "all" || d.group === group) && (d.name + d.desc).toLowerCase().includes(q.toLowerCase())),
    [q, group],
  );

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="افزودن اندیکاتور" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>اندیکاتورها</h3>
          <button className="x" onClick={onClose} aria-label="بستن">×</button>
        </div>
        <input className="search" autoFocus placeholder="جستجو… (مثلاً MACD)" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          {([["all", "همه"], ["overlay", "روی قیمت"], ["pane", "پنل جدا"]] as const).map(([g, l]) => (
            <button key={g} className={group === g ? "on" : ""} onClick={() => setGroup(g)}>{l}</button>
          ))}
        </div>
        <ul className="ind-list">
          {list.map((d) => (
            <li key={d.id}>
              <button onClick={() => onAdd(d.id)}>
                <div>
                  <b dir="ltr">{d.name}</b>
                  <small>{d.desc}</small>
                </div>
                <span className="tag">{count(d.id) > 0 ? `${count(d.id)} فعال · ` : ""}{d.group === "overlay" ? "روی قیمت" : "پنل جدا"}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="empty">اندیکاتوری پیدا نشد.</li>}
        </ul>
      </div>
    </div>
  );
}
