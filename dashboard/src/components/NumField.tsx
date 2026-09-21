import { useEffect, useState } from "react";

/**
 * A number box you can actually edit: while typing (even with the box empty) nothing is forced;
 * the value is applied as soon as it is valid and clamped into [min, max] when you leave the box.
 */
export default function NumField({ value, min, max, step, onChange }: { value: number; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string, final: boolean) => {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) {
      if (final) setText(String(value));
      return;
    }
    const c = Math.min(max, Math.max(min, n));
    if (n >= min && n <= max) onChange(c);
    if (final) { onChange(c); setText(String(c)); }
  };
  return (
    <input
      type="number" inputMode="decimal" dir="ltr" min={min} max={max} step={step} value={text}
      onChange={(e) => { setText(e.target.value); commit(e.target.value, false); }}
      onBlur={(e) => commit(e.target.value, true)}
    />
  );
}
