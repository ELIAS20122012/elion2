interface Props { value: number; label: string; tone: "calm" | "watch" | "high" }

const COLOR = { calm: "var(--up)", watch: "var(--accent-2)", high: "var(--down)" } as const;

/** Half-circle gauge, 0..100. */
export default function Gauge({ value, label, tone }: Props) {
  const R = 52;
  const len = Math.PI * R;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="gauge" role="img" aria-label={`${label}: ${v} از ۱۰۰`}>
      <svg viewBox="0 0 120 72" width="100%">
        <defs>
          <linearGradient id="g-arc" x1="0" x2="1">
            <stop offset="0" stopColor="var(--up)" />
            <stop offset="0.55" stopColor="var(--accent-2)" />
            <stop offset="1" stopColor="var(--down)" />
          </linearGradient>
        </defs>
        <path d={`M ${60 - R} 62 A ${R} ${R} 0 0 1 ${60 + R} 62`} fill="none" stroke="var(--surface-3)" strokeWidth="9" strokeLinecap="round" />
        <path d={`M ${60 - R} 62 A ${R} ${R} 0 0 1 ${60 + R} 62`} fill="none" stroke="url(#g-arc)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(v / 100) * len} ${len}`} style={{ transition: "stroke-dasharray .5s ease" }} />
      </svg>
      <div className="gauge-val" style={{ color: COLOR[tone] }}>{v}</div>
      <div className="gauge-label" style={{ color: COLOR[tone] }}>{label}</div>
    </div>
  );
}
