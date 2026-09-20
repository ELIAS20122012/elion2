import { useEffect, useState } from "react";
import { durationSec, fmtDuration, money, net } from "../lib/analytics";
import { fmtDateTime, fmtPrice } from "../lib/data";
import { journalApi, type JTrade, type Notes } from "../lib/journalApi";

export const EMOTIONS = ["آرام و متمرکز", "بی‌حوصله", "فشار مالی", "عصبانی", "استرس", "طمع / سرمایه بی‌اهمیت"];
export const ERRORS = ["ورود بدون ستاپ", "ورود در نقطه‌ی نامناسب با آگاهی", "ادامه‌ی ترید بعد از سود", "حجم بیش از حد", "جابه‌جایی حد ضرر", "ماندن پای چارت بعد از توقف"];
const VALID = [["yes", "ستاپ معتبر"], ["no", "ستاپ نامعتبر"], ["unsure", "نامطمئن"]] as const;

interface Props {
  trade: JTrade;
  onClose: () => void;
  onSaved: () => void;
}

/** Side panel: trade details + quick, one-click behavioural tags (no mandatory text). */
export default function TradeDrawer({ trade, onClose, onSaved }: Props) {
  const [n, setN] = useState<Notes>({ setup_valid: trade.setup_valid, setup_id: trade.setup_id, emotion: trade.emotion, error: trade.error, note: trade.note });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setN({ setup_valid: trade.setup_valid, setup_id: trade.setup_id, emotion: trade.emotion, error: trade.error, note: trade.note });
    setErr(null);
  }, [trade.id, trade.setup_valid, trade.setup_id, trade.emotion, trade.error, trade.note]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const toggle = <K extends keyof Notes>(k: K, v: Notes[K]) => setN((p) => ({ ...p, [k]: p[k] === v ? null : v }));
  const save = async () => {
    setSaving(true);
    try {
      await journalApi.saveNotes(trade.id, n);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
    setSaving(false);
  };

  const result = net(trade);
  const rows: [string, string][] = [
    ["ورود", `${fmtDateTime(trade.open_time)} @ ${fmtPrice(trade.open_price)}`],
    ["خروج", trade.close_time ? `${fmtDateTime(trade.close_time)} @ ${fmtPrice(trade.close_price)}` : "باز"],
    ["مدت", trade.close_time ? fmtDuration(durationSec(trade)) : "—"],
    ["حجم", String(trade.volume)],
    ["حد ضرر / هدف", `${fmtPrice(trade.sl)} / ${fmtPrice(trade.tp)}`],
    ["کمیسیون + سواپ", (trade.commission + trade.swap).toFixed(2)],
    ...(trade.mfe != null && trade.mae != null
      ? ([
          ["بیشترین سود شناور (MFE)", money(trade.mfe)],
          ["بیشترین ضرر شناور (MAE)", money(trade.mae)],
          ...(trade.close_time && trade.mfe > trade.profit ? [["سود پس‌داده‌شده از اوج", money(-(trade.mfe - trade.profit))]] : []),
        ] as [string, string][])
      : []),
    ["منبع", trade.source ?? "—"],
  ];

  return (
    <div className="drawer-back" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label="جزئیات معامله" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3><span dir="ltr">{trade.symbol}</span> · <span className={trade.direction === "buy" ? "up" : "down"}>{trade.direction === "buy" ? "خرید" : "فروش"}</span> <small className="muted" dir="ltr">#{trade.ticket}</small></h3>
          <button className="x" onClick={onClose} aria-label="بستن">×</button>
        </div>
        <div className={`big-result ${result >= 0 ? "up" : "down"}`} dir="ltr">{trade.close_time ? money(result) : "باز"}</div>
        <dl className="kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd dir="ltr">{v}</dd></div>)}</dl>

        <section className="tagsec">
          <h4>اعتبار ستاپ</h4>
          <div className="chipset">{VALID.map(([v, l]) => <button key={v} className={n.setup_valid === v ? "on" : ""} onClick={() => toggle("setup_valid", v)}>{l}</button>)}</div>
          <h4>حالت روانی</h4>
          <div className="chipset">{EMOTIONS.map((e) => <button key={e} className={n.emotion === e ? "on" : ""} onClick={() => toggle("emotion", e)}>{e}</button>)}</div>
          <h4>خطای اجرا</h4>
          <div className="chipset">{ERRORS.map((e) => <button key={e} className={n.error === e ? "on" : ""} onClick={() => toggle("error", e)}>{e}</button>)}</div>
          <p className="muted small">«ضرر ستاپ» با «خطای اجرا» فرق دارد: یک ستاپ معتبر با اجرای درست هم می‌تواند ضرر بدهد.</p>
          <textarea placeholder="یادداشت (اختیاری)" value={n.note ?? ""} onChange={(e) => setN((p) => ({ ...p, note: e.target.value || null }))} rows={3} />
        </section>
        {err && <p className="err">{err}</p>}
        <button className="btn primary wide" onClick={save} disabled={saving}>ذخیره</button>
      </aside>
    </div>
  );
}
