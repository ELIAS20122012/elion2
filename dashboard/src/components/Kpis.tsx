import { fmtDuration, money, type Summary } from "../lib/analytics";

export default function Kpis({ s, full = false }: { s: Summary; full?: boolean }) {
  const items: { label: string; value: string; tone?: "up" | "down" }[] = [
    { label: "معاملات بسته", value: String(s.count) },
    { label: "نرخ برد", value: s.count ? `${Math.round(s.winRate * 100)}%` : "—" },
    { label: "سود/زیان خالص", value: money(s.net), tone: s.net >= 0 ? "up" : "down" },
    { label: "ضریب سود (PF)", value: s.profitFactor != null ? s.profitFactor.toFixed(2) : "—" },
  ];
  if (full) {
    items.push(
      { label: "میانگین سود", value: s.wins ? money(s.avgWin) : "—", tone: "up" },
      { label: "میانگین زیان", value: s.losses ? money(s.avgLoss) : "—", tone: "down" },
      { label: "نسبت سود به زیان", value: s.payoff != null ? s.payoff.toFixed(2) : "—" },
      { label: "امید ریاضی هر معامله", value: s.count ? money(s.expectancy) : "—", tone: s.expectancy >= 0 ? "up" : "down" },
      { label: "بیشترین افت (Drawdown)", value: s.count ? money(-s.maxDrawdown) : "—", tone: "down" },
      { label: "بهترین / بدترین", value: s.count ? `${money(s.bestTrade)} / ${money(s.worstTrade)}` : "—" },
      { label: "بیشترین سری برد / باخت", value: s.count ? `${s.maxWinStreak} / ${s.maxLossStreak}` : "—" },
      { label: "میانگین مدت معامله", value: s.count ? fmtDuration(s.avgDurationSec) : "—" },
    );
  }
  return (
    <div className="kpis">
      {items.map((k) => (
        <div key={k.label} className="card kpi">
          <span>{k.label}</span>
          <b className={k.tone ?? ""} dir="ltr">{k.value}</b>
        </div>
      ))}
    </div>
  );
}
