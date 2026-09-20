import { TOOLS, type ToolId } from "../lib/drawings";
import Icon from "./Icon";

const COLORS = ["#e6b95a", "#4da3ff", "#26a69a", "#ef5350", "#c084fc", "#f8fafc"];

interface Props {
  tool: ToolId;
  onTool: (t: ToolId) => void;
  magnet: boolean;
  onMagnet: () => void;
  color: string;
  onColor: (c: string) => void;
  hasSelection: boolean;
  count: number;
  onDeleteSelected: () => void;
  onUndo: () => void;
  onClear: () => void;
}

export default function DrawToolbar(p: Props) {
  return (
    <div className="toolbar" role="toolbar" aria-label="ابزارهای رسم">
      {TOOLS.map((t) => (
        <button key={t.id} className={p.tool === t.id ? "on" : ""} onClick={() => p.onTool(t.id)} title={t.label} aria-label={t.label} aria-pressed={p.tool === t.id}>
          <Icon name={t.icon} size={18} />
        </button>
      ))}
      <hr />
      <button className={p.magnet ? "on" : ""} onClick={p.onMagnet} title="آهن‌ربا: چسبیدن به High/Low/Open/Close" aria-label="آهن‌ربا" aria-pressed={p.magnet}>
        <Icon name="magnet" size={18} />
      </button>
      <div className="colors">
        {COLORS.map((c) => (
          <button key={c} className={`sw ${p.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => p.onColor(c)} aria-label={`رنگ ${c}`} />
        ))}
      </div>
      <hr />
      <button onClick={p.onDeleteSelected} disabled={!p.hasSelection} title="حذف انتخاب‌شده (Delete)" aria-label="حذف انتخاب‌شده"><Icon name="trash" size={18} /></button>
      <button onClick={p.onUndo} disabled={p.count === 0} title="حذف آخرین رسم" aria-label="بازگردانی"><Icon name="undo" size={18} /></button>
      <button onClick={p.onClear} disabled={p.count === 0} title="پاک‌کردن همه‌ی رسم‌ها" aria-label="پاک‌کردن همه"><Icon name="x" size={18} /></button>
    </div>
  );
}
