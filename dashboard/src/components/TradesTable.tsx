import { fmtDateTime, fmtPrice, type Trade } from "../lib/data";

export default function TradesTable({ trades, lastTime }: { trades: Trade[]; lastTime: number }) {
  if (trades.length === 0) return <div className="empty">هنوز معامله‌ای در این بازه نیست.</div>;
  const isClosed = (t: Trade) => !!t.close_time && t.close_time <= lastTime;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>تیکت</th><th>جهت</th><th>حجم</th><th>ورود</th><th>قیمت ورود</th><th>خروج</th><th>قیمت خروج</th><th>سود</th></tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.ticket}>
              <td>{t.ticket.slice(-6)}</td>
              <td className={t.direction === "buy" ? "up" : "down"}>{t.direction === "buy" ? "BUY" : "SELL"}</td>
              <td>{t.volume}</td>
              <td>{fmtDateTime(t.open_time)}</td>
              <td>{fmtPrice(t.open_price)}</td>
              <td>{isClosed(t) ? fmtDateTime(t.close_time!) : "باز"}</td>
              <td>{isClosed(t) ? fmtPrice(t.close_price) : "—"}</td>
              <td className={(t.profit ?? 0) >= 0 ? "up" : "down"}>{isClosed(t) ? `${(t.profit ?? 0) >= 0 ? "+" : ""}${t.profit}$` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
