import { fmtDuration, money, type Summary } from "../lib/analytics";
import Icon from "./Icon";

export default function Kpis({ s, full = false }: { s: Summary; full?: boolean }) {
  const items: { label: string; value: string; tone?: "up" | "down"; icon: string }[] = [
    { label: "معاملات بسته", value: String(s.count), icon: "notebook" },
    { label: "نرخ برد", value: s.count ? `${Math.round(s.winRate * 100)}%` : "—", icon: "target" },
    { label: "سود/زیان خالص", value: money(s.net), tone: s.net >= 0 ? "up" : "down", icon: "trend" },
    { label: "ضریب سود (PF)", value: s.profitFactor != null ? s.profitFactor.toFixed(2) : "—", icon: "scale" },
  ];
  if (full) {
    items.push(
      { label: "میانگین سود", value: s.wins ? money(s.avgWin) : "—", tone: "up", icon: "trend" },
      { label: "میانگین زیان", value: s.losses ? money(s.avgLoss) : "—", tone: "down", icon: "alert" },
      { label: "نسبت سود به زیان", value: s.payoff != null ? s.payoff.toFixed(2) : "—", icon: "scale" },
      { label: "امید ریاضی هر معامله", value: s.count ? money(s.expectancy) : "—", tone: s.expectancy >= 0 ? "up" : "down", icon: "target" },
      { label: "بیشترین افت (Drawdown)", value: s.count ? money(-s.maxDrawdown) : "—", tone: "down", icon: "bolt" },
      { label: "بهترین / بدترین", value: s.count ? `${money(s.bestTrade)} / ${money(s.worstTrade)}` : "—", icon: "spark" },
      { label: "بیشترین سری برد / باخت", value: s.count ? `${s.maxWinStreak} / ${s.maxLossStreak}` : "—", icon: "activity" },
      { label: "میانگین مدت معامله", value: s.count ? fmtDuration(s.avgDurationSec) : "—", icon: "clock" },
    );
  }
  return (
    <div className="kpis">
      {items.map((k) => (
        <div key={k.label} className="card kpi kpi-ico">
          <span className={`ico-avatar ${k.tone ?? ""}`}><Icon name={k.icon} size={17} /></span>
          <div>
            <span>{k.label}</span>
            <b className={k.tone ?? ""} dir="ltr">{k.value}</b>
          </div>
        </div>
      ))}
    </div>
  );
}
