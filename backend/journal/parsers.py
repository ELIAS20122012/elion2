"""Parsers that turn a broker statement (MT4/MT5 HTML report or a CSV) into trade dicts.

Tolerant on purpose: broker templates differ, so rows are recognised by shape (a date, a buy/sell cell,
numbers at the end) rather than by fixed column headers.
"""
import csv
import io
import re
from datetime import datetime, timezone
from html import unescape

DATE_RE = re.compile(r"^(\d{4})[.\-/](\d{2})[.\-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$")
TAG_RE = re.compile(r"<[^>]+>")
ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
CELL_RE = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S | re.I)


class ImportError_(Exception):
    pass


def decode(raw: bytes) -> str:
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def parse_date(s: str) -> int | None:
    m = DATE_RE.match(s.strip())
    if not m:
        return None
    y, mo, d, h, mi, sec = (int(x) if x else 0 for x in m.groups())
    return int(datetime(y, mo, d, h, mi, sec, tzinfo=timezone.utc).timestamp())


def num(s: str) -> float | None:
    s = s.replace("\xa0", "").replace(" ", "")
    s = s.replace(",", "") if "," in s and "." in s else s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _cells(row_html: str) -> list[str]:
    return [unescape(TAG_RE.sub("", c)).strip() for c in CELL_RE.findall(row_html)]


def parse_html(text: str) -> list[dict]:
    trades = []
    for row in ROW_RE.findall(text):
        c = _cells(row)
        if len(c) < 12:
            continue
        # MT4: Ticket | Open Time | Type | Size | Item | Price | S/L | T/P | Close Time | Price | Commission | [Taxes] | Swap | Profit
        if c[1] and parse_date(c[1]) and c[2].lower() in ("buy", "sell") and c[0].isdigit():
            open_t, close_t = parse_date(c[1]), parse_date(c[8]) if len(c) > 8 else None
            tail = [num(x) for x in c[10:]]
            tail = [x for x in tail if x is not None]
            if len(tail) < 3:
                continue
            profit, swap, commission = tail[-1], tail[-2], tail[0]
            trades.append({
                "ticket": c[0], "direction": c[2].lower(), "volume": num(c[3]), "symbol": c[4].upper(),
                "open_time": open_t, "open_price": num(c[5]), "sl": num(c[6]) or None, "tp": num(c[7]) or None,
                "close_time": close_t, "close_price": num(c[9]),
                "commission": commission, "swap": swap, "profit": profit,
            })
        # MT5 positions: Time | Position | Symbol | Type | Volume | Price | S/L | T/P | Time | Price | Commission | Swap | Profit
        elif parse_date(c[0]) and c[1].isdigit() and c[3].lower() in ("buy", "sell"):
            tail = [num(x) for x in c[10:]]
            tail = [x for x in tail if x is not None]
            if len(tail) < 3:
                continue
            trades.append({
                "ticket": c[1], "direction": c[3].lower(), "symbol": c[2].upper(), "volume": num(c[4].split("/")[0]),
                "open_time": parse_date(c[0]), "open_price": num(c[5]), "sl": num(c[6]) or None, "tp": num(c[7]) or None,
                "close_time": parse_date(c[8]), "close_price": num(c[9]),
                "commission": tail[0], "swap": tail[-2], "profit": tail[-1],
            })
    return [t for t in trades if t["volume"] and t["open_time"] and t["open_price"] is not None]


ALIASES = {
    "ticket": ("ticket", "order", "position", "deal", "id"),
    "symbol": ("symbol", "item", "instrument"),
    "direction": ("type", "direction", "side"),
    "volume": ("volume", "size", "lots", "lot"),
    "open_time": ("open time", "opentime", "time open", "open_time", "time"),
    "open_price": ("open price", "openprice", "price open", "open_price", "price"),
    "close_time": ("close time", "closetime", "time close", "close_time"),
    "close_price": ("close price", "closeprice", "price close", "close_price"),
    "sl": ("s/l", "sl", "stop loss", "stoploss"),
    "tp": ("t/p", "tp", "take profit", "takeprofit"),
    "commission": ("commission", "comm"),
    "swap": ("swap",),
    "profit": ("profit", "pnl", "p/l", "net profit"),
}


def parse_csv(text: str) -> list[dict]:
    sample = text[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    if not rows:
        return []
    header = [h.strip().lower() for h in rows[0]]
    idx: dict[str, int] = {}
    for field, names in ALIASES.items():
        for n in names:
            if n in header and field not in idx:
                idx[field] = header.index(n)
    need = {"symbol", "direction", "volume", "open_time", "open_price"}
    if not need <= idx.keys():
        raise ImportError_("ستون‌های لازم در CSV پیدا نشد (Symbol, Type, Volume, Open Time, Open Price)")
    out = []
    for r in rows[1:]:
        if len(r) <= max(idx.values()):
            continue
        g = lambda f: r[idx[f]].strip() if f in idx else ""
        direction = g("direction").lower()
        if direction not in ("buy", "sell"):
            continue
        ot = parse_date(g("open_time"))
        if ot is None:
            continue
        out.append({
            "ticket": g("ticket") or f"{ot}-{g('symbol')}-{g('open_price')}", "symbol": g("symbol").upper(), "direction": direction,
            "volume": num(g("volume")), "open_time": ot, "open_price": num(g("open_price")),
            "close_time": parse_date(g("close_time")) if "close_time" in idx else None,
            "close_price": num(g("close_price")) if "close_price" in idx else None,
            "sl": num(g("sl")) or None, "tp": num(g("tp")) or None,
            "commission": num(g("commission")) or 0, "swap": num(g("swap")) or 0, "profit": num(g("profit")) or 0,
        })
    return [t for t in out if t["volume"] and t["open_price"] is not None]


def parse_statement(raw: bytes, filename: str = "") -> list[dict]:
    text = decode(raw)
    is_html = "<table" in text[:200000].lower() or filename.lower().endswith((".htm", ".html"))
    trades = parse_html(text) if is_html else parse_csv(text)
    if not trades:
        raise ImportError_("هیچ معامله‌ای در فایل پیدا نشد. (گزارش «Account History → Detailed Report» MT4 یا CSV را بدهید)")
    return trades
