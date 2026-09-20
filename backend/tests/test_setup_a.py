from app.strategy.config import DEFAULT_CONFIG
from app.strategy.indicators import Candle
from app.strategy.level_detector import (
    LEVEL_DETECTED,
    SIGNAL_ACTIVE,
    LevelStructure,
    _detect_setup_a,
)


def c(o, h, l, cl):
    return Candle(time="t", open=o, high=h, low=l, close=cl)


def make_pullback_then_breakout(extra_flat_candles=0):
    candles = [c(105, 106, 104, 105) for _ in range(20)]  # 0..19، High2 روی 19
    candles += [
        c(105, 105.5, 102, 103),   # 20
        c(103, 104, 101, 102),     # 21
        c(102, 103, 99.5, 100.5),  # 22
        c(100.5, 103, 100, 102.5), # 23
        c(102.5, 104, 101.5, 103), # 24  Swing High
        c(103, 103.5, 99, 99.5),   # 25  اولین بسته‌شدن زیر Level
        c(99.5, 100, 97, 97.5),    # 26
        c(97.5, 99, 96.5, 98.5),   # 27
        c(98.5, 101, 98, 100.2),   # 28  cross Level ولی زیر خط روند
        c(100.2, 100.5, 98.5, 99), # 29
        c(99, 99.5, 97, 97.5),     # 30
        c(97.5, 98, 96, 96.5),     # 31
        c(96.5, 98.5, 96, 98),     # 32
        c(98, 99.8, 97.5, 99.5),   # 33  Swing High پایین‌تر
        c(99.5, 99.6, 97.5, 98),   # 34
        c(98, 98.5, 96.5, 97),     # 35
        c(97, 97.5, 95.5, 96.5),   # 36  کف پولبک
        c(96.5, 97.8, 96, 97.5),   # 37
        c(97.5, 98.2, 97, 98),     # 38
        c(98, 102, 97.8, 101.5),   # 39  Full-Body، cross Level و خط روند
    ]
    # High یکسان (۱۰۲٫۵) تا هیچ Swing High جدیدی ساخته نشود و خط روند تغییر نکند
    candles += [c(101.5, 102.5, 101.2, 101.5) for _ in range(extra_flat_candles)]
    return candles


LEVEL = LevelStructure(
    high1_idx=5, low_idx=10, high2_idx=19, level_price=100.0, high1_price=106.0, high2_price=110.0
)


def test_buy_signal_on_reclaim_of_lost_level():
    candles = make_pullback_then_breakout()
    state, signal, _ = _detect_setup_a(candles, LEVEL, DEFAULT_CONFIG)
    assert state == SIGNAL_ACTIVE
    assert signal.direction == "buy"
    assert signal.entry == 101.5
    assert signal.stop_loss == 95.5  # کف پولبک
    assert signal.take_profit == 113.5  # R:R = 1:2


def test_first_strong_candle_above_level_is_not_a_signal_without_pullback():
    candles = [c(105, 106, 104, 105) for _ in range(20)]
    candles += [c(105, 108, 104.5, 107.5) for _ in range(10)]  # هرگز زیر Level بسته نمی‌شود
    state, signal, notes = _detect_setup_a(candles, LEVEL, DEFAULT_CONFIG)
    assert state == LEVEL_DETECTED
    assert signal is None


def test_stale_signal_is_not_active():
    candles = make_pullback_then_breakout(extra_flat_candles=10)
    state, signal, notes = _detect_setup_a(candles, LEVEL, DEFAULT_CONFIG)
    assert state == LEVEL_DETECTED
    assert signal is None
    assert any("قدیمی" in n for n in notes)
