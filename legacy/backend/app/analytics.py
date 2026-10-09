from collections import defaultdict
from typing import List, Optional

from sqlalchemy.orm import Session

from . import models


def compute_summary(db: Session, account_id: str) -> dict:
    trades: List[models.Trade] = (
        db.query(models.Trade).filter(models.Trade.account_id == account_id).all()
    )
    closed = [t for t in trades if t.status == models.TradeStatus.closed and t.profit is not None]
    open_trades = [t for t in trades if t.status == models.TradeStatus.open]

    wins = [t for t in closed if t.profit > 0]
    losses = [t for t in closed if t.profit < 0]

    gross_profit = sum(t.profit for t in wins)
    gross_loss = abs(sum(t.profit for t in losses))
    net_profit = sum(t.profit for t in closed)

    win_rate = (len(wins) / len(closed)) if closed else None
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else None
    expectancy = (net_profit / len(closed)) if closed else None

    max_dd, max_dd_pct = _max_drawdown(db, account_id)

    heartbeat = (
        db.query(models.Heartbeat).filter(models.Heartbeat.account_id == account_id).first()
    )

    return {
        "total_trades": len(trades),
        "closed_trades": len(closed),
        "open_trades": len(open_trades),
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "expectancy": expectancy,
        "net_profit": net_profit,
        "max_drawdown": max_dd,
        "max_drawdown_pct": max_dd_pct,
        "last_heartbeat": heartbeat.last_seen if heartbeat else None,
    }


def _max_drawdown(db: Session, account_id: str) -> tuple[Optional[float], Optional[float]]:
    snapshots = (
        db.query(models.Snapshot)
        .filter(models.Snapshot.account_id == account_id)
        .order_by(models.Snapshot.timestamp.asc())
        .all()
    )
    if not snapshots:
        return None, None

    peak = snapshots[0].equity
    max_dd = 0.0
    max_dd_pct = 0.0
    for s in snapshots:
        if s.equity > peak:
            peak = s.equity
        drawdown = peak - s.equity
        drawdown_pct = (drawdown / peak * 100) if peak > 0 else 0.0
        if drawdown > max_dd:
            max_dd = drawdown
        if drawdown_pct > max_dd_pct:
            max_dd_pct = drawdown_pct

    return max_dd, max_dd_pct


def compute_breakdown(db: Session, account_id: str) -> dict:
    """تفکیک بر اساس نماد + رشته‌های برد/باخت متوالی (streaks).

    نکته: R-multiple عمداً محاسبه نشده -- برای آن باید اندازهٔ کانترکت/ارزش
    پوینت هر نماد را بدانیم که EA فعلاً ارسال نمی‌کند؛ حدس زدنش عدد نادرست
    تولید می‌کند، پس به‌جای آن فقط سود/زیان پولی واقعی گزارش می‌شود.
    """
    closed = (
        db.query(models.Trade)
        .filter(
            models.Trade.account_id == account_id,
            models.Trade.status == models.TradeStatus.closed,
            models.Trade.profit.isnot(None),
        )
        .order_by(models.Trade.close_time.asc())
        .all()
    )

    by_symbol: dict = defaultdict(lambda: {"trades": 0, "wins": 0, "net_profit": 0.0})
    for t in closed:
        row = by_symbol[t.symbol]
        row["trades"] += 1
        row["wins"] += 1 if t.profit > 0 else 0
        row["net_profit"] += t.profit

    symbol_breakdown = [
        {
            "symbol": symbol,
            "trades": row["trades"],
            "win_rate": (row["wins"] / row["trades"]) if row["trades"] else None,
            "net_profit": row["net_profit"],
        }
        for symbol, row in by_symbol.items()
    ]

    current_streak = 0
    max_win_streak = 0
    max_loss_streak = 0
    running = 0
    for t in closed:
        if t.profit > 0:
            running = running + 1 if running > 0 else 1
            max_win_streak = max(max_win_streak, running)
        elif t.profit < 0:
            running = running - 1 if running < 0 else -1
            max_loss_streak = max(max_loss_streak, abs(running))
        else:
            running = 0
    current_streak = running

    best_trade = max((t.profit for t in closed), default=None)
    worst_trade = min((t.profit for t in closed), default=None)

    return {
        "by_symbol": symbol_breakdown,
        "current_streak": current_streak,
        "max_win_streak": max_win_streak,
        "max_loss_streak": max_loss_streak,
        "best_trade": best_trade,
        "worst_trade": worst_trade,
    }
