"""A small candlestick + MACD chart as a PNG, drawn with the standard library only (no image packages).

Used so the AI reviewer of a robot signal (journal/signals.py) sees the same picture every time, drawn
from the real candles the detector used - not a screenshot that depends on the chart's zoom level.
No text is drawn (no font available); every number is sent to the model as text alongside the image.
"""
from __future__ import annotations

import struct
import zlib

BG = (10, 20, 23)
GRID = (26, 42, 47)
UP = (38, 181, 141)
DOWN = (224, 70, 63)
MACD = (59, 130, 246)
SIGNAL = (239, 68, 68)
HIGH_MARK = (255, 157, 61)   # divergence at highs (same colours as the Trade page overlay)
LOW_MARK = (46, 230, 166)
CROSS = (233, 215, 176)


class Canvas:
    def __init__(self, w: int, h: int, bg=BG):
        self.w, self.h = w, h
        self.px = bytearray(bytes(bg) * (w * h))

    def dot(self, x: int, y: int, c) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 3
            self.px[i:i + 3] = bytes(c)

    def rect(self, x0: int, y0: int, x1: int, y1: int, c) -> None:
        x0, x1 = sorted((max(0, x0), min(self.w - 1, x1)))
        y0, y1 = sorted((max(0, y0), min(self.h - 1, y1)))
        row = bytes(c) * (x1 - x0 + 1)
        for y in range(y0, y1 + 1):
            i = (y * self.w + x0) * 3
            self.px[i:i + len(row)] = row

    def line(self, x0: int, y0: int, x1: int, y1: int, c, dash: int = 0) -> None:
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err, n = dx + dy, 0
        while True:
            if not dash or (n // dash) % 2 == 0:
                self.dot(x0, y0, c)
            n += 1
            if x0 == x1 and y0 == y1:
                return
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def disc(self, cx: int, cy: int, r: int, c) -> None:
        for y in range(-r, r + 1):
            for x in range(-r, r + 1):
                if x * x + y * y <= r * r:
                    self.dot(cx + x, cy + y, c)

    def png(self) -> bytes:
        raw = b"".join(b"\x00" + bytes(self.px[y * self.w * 3:(y + 1) * self.w * 3]) for y in range(self.h))

        def chunk(tag: bytes, data: bytes) -> bytes:
            return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

        return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and v == v and abs(v) != float("inf")


def render(candles: list[list[float]], macd: list | None = None, signal: list | None = None,
           marks: dict | None = None, width: int = 960, height: int = 540) -> bytes:
    """candles: [time, open, high, low, close, ...]. marks: {"a": idx, "b": idx, "cross": idx, "side": "high"|"low"}."""
    cv = Canvas(width, height)
    n = len(candles)
    if n == 0:
        return cv.png()
    has_macd = bool(macd) and any(_finite(v) for v in macd)
    price_h = int(height * (0.70 if has_macd else 0.96))
    pad = 8
    cw = (width - 2 * pad) / n
    X = lambda i: int(pad + (i + 0.5) * cw)  # noqa: E731

    lo = min(c[3] for c in candles)
    hi = max(c[2] for c in candles)
    span = (hi - lo) or 1.0
    Y = lambda v: int(pad + (hi - v) / span * (price_h - 2 * pad))  # noqa: E731

    for k in range(1, 5):  # horizontal grid
        cv.line(0, int(price_h * k / 5), width - 1, int(price_h * k / 5), GRID, dash=4)
    body = max(1, int(cw * 0.35))
    for i, c in enumerate(candles):
        o, h, l, cl = c[1], c[2], c[3], c[4]
        col = UP if cl >= o else DOWN
        x = X(i)
        cv.line(x, Y(h), x, Y(l), col)
        cv.rect(x - body, Y(max(o, cl)), x + body, max(Y(min(o, cl)), Y(max(o, cl)) + 1) - 0, col)

    if has_macd:
        cv.line(0, price_h, width - 1, price_h, GRID)
        vals = [v for v in (list(macd) + list(signal or [])) if _finite(v)]
        m = max(abs(v) for v in vals) or 1.0
        top, bot = price_h + pad, height - pad
        mid = (top + bot) // 2
        MY = lambda v: int(mid - v / m * (bot - top) / 2)  # noqa: E731
        cv.line(0, mid, width - 1, mid, GRID, dash=3)
        for series, col in ((macd, MACD), (signal or [], SIGNAL)):
            prev = None
            for i, v in enumerate(series[:n]):
                if not _finite(v):
                    prev = None
                    continue
                pt = (X(i), MY(v))
                if prev:
                    cv.line(prev[0], prev[1], pt[0], pt[1], col)
                prev = pt

    if marks:
        col = HIGH_MARK if marks.get("side") == "high" else LOW_MARK
        pts = []
        for k in ("a", "b"):
            i = marks.get(k)
            if isinstance(i, int) and 0 <= i < n:
                y = Y(candles[i][2] if marks.get("side") == "high" else candles[i][3])
                pts.append((X(i), y))
                cv.disc(X(i), y + (-9 if marks.get("side") == "high" else 9), 4, col)
        if len(pts) == 2:
            cv.line(pts[0][0], pts[0][1], pts[1][0], pts[1][1], col)
        mpts = []
        for k in ("a_macd", "b_macd"):
            i = marks.get(k)
            if has_macd and isinstance(i, int) and 0 <= i < n and _finite(macd[i]):
                mpts.append((X(i), MY(macd[i])))
        if len(mpts) == 2:
            cv.line(mpts[0][0], mpts[0][1], mpts[1][0], mpts[1][1], col)
        ci = marks.get("cross")
        if isinstance(ci, int) and 0 <= ci < n:
            cv.line(X(ci), 0, X(ci), height - 1, CROSS, dash=5)
    return cv.png()
