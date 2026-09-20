import { TOOLS, type Drawing } from "../lib/drawings";
import Icon from "./Icon";

const COLORS = ["#e6b95a", "#4da3ff", "#26a69a", "#ef5350", "#c084fc", "#f8fafc"];
const WIDTHS = [1, 2, 3, 4];

interface Props {
  drawing: Drawing;
  onChange: (patch: Partial<Drawing>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/** Floating settings for the selected drawing (like TradingView's mini toolbar). */
export default function DrawingProps({ drawing: d, onChange, onDuplicate, onDelete }: Props) {
  const label = TOOLS.find((t) => t.id === d.type)?.label ?? "";
  return (
    <div className="dprops" role="toolbar" aria-label="تنظیمات رسم" dir="rtl">
      <span className="muted small">{label}</span>
      <div className="dp-group">
        {COLORS.map((c) => (
          <button key={c} className={`sw ${d.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => onChange({ color: c })} aria-label={`رنگ ${c}`} />
        ))}
      </div>
      <div className="dp-group" dir="ltr">
        {WIDTHS.map((w) => (
          <button key={w} className={`wd ${(d.width ?? 1.6) === w || (!d.width && w === 2) ? "on" : ""}`} onClick={() => onChange({ width: w })} title={`ضخامت ${w}`}>
            <i style={{ height: w }} />
          </button>
        ))}
        <button className={`wd ${d.dashed ? "on" : ""}`} onClick={() => onChange({ dashed: !d.dashed })} title="خط‌چین">╌╌</button>
      </div>
      {d.type === "text" && (
        <button className="btn" onClick={() => { const t = window.prompt("متن:", d.text ?? ""); if (t) onChange({ text: t }); }}>ویرایش متن</button>
      )}
      <button className="btn icon" onClick={onDuplicate} title="تکثیر" aria-label="تکثیر"><Icon name="copy" size={16} /></button>
      <button className="btn icon danger" onClick={onDelete} title="حذف (Delete)" aria-label="حذف"><Icon name="trash" size={16} /></button>
    </div>
  );
}
