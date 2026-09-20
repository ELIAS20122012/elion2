import random

from app.strategy.indicators import Candle
from app.strategy.level_detector import evaluate, NO_DATA, NO_LEVEL
from app.strategy.config import DEFAULT_CONFIG


def make_flat_candles(n, price=2000.0):
    candles = []
    for i in range(n):
        candles.append(Candle(time=str(i), open=price, high=price + 0.5, low=price - 0.5, close=price))
    return candles


def make_synthetic_level_setup():
    """یک ساختار ساختگی High1->Low->High2 با دایورجنس معمولی MACD می‌سازد تا
    مطمئن شویم evaluate() آن را بدون کرش تشخیص می‌دهد. این داده واقعی بازار
    نیست -- فقط برای صحت‌سنجی کد."""
    random.seed(42)
    candles = []
    price = 2000.0

    # رمپ اول به سمت High1
    for i in range(40):
        price += 0.8
        candles.append(Candle(time=str(i), open=price - 0.5, high=price + 0.3, low=price - 0.8, close=price))

    # High1 (سریع‌تر، مومنتوم بالا -> MACD بزرگ)
    for i in range(6):
        price += 2.0
        candles.append(Candle(time=str(len(candles)), open=price - 1.5, high=price + 0.5, low=price - 1.6, close=price))

    # افت به Low
    for i in range(30):
        price -= 1.0
        candles.append(Candle(time=str(len(candles)), open=price + 0.5, high=price + 0.8, low=price - 0.3, close=price))

    # رمپ دوم آهسته‌تر به سمت High2 (بالاتر از High1 اما مومنتوم کمتر -> دایورجنس)
    for i in range(60):
        price += 0.5
        candles.append(Candle(time=str(len(candles)), open=price - 0.3, high=price + 0.4, low=price - 0.5, close=price))

    for i in range(20):
        price += 0.1
        candles.append(Candle(time=str(len(candles)), open=price - 0.05, high=price + 0.15, low=price - 0.1, close=price))

    return candles


def test_insufficient_history_returns_no_data():
    result = evaluate(make_flat_candles(10), DEFAULT_CONFIG)
    assert result.state == NO_DATA


def test_flat_market_has_no_level():
    result = evaluate(make_flat_candles(200), DEFAULT_CONFIG)
    assert result.state == NO_LEVEL
    assert result.signal is None


def test_synthetic_structure_does_not_crash_and_returns_known_state():
    candles = make_synthetic_level_setup()
    result = evaluate(candles, DEFAULT_CONFIG)
    known_states = {
        "NO_DATA", "NO_LEVEL", "LEVEL_DETECTED", "STRUCTURE_BREAK",
        "WAITING_FOR_DISPLACEMENT", "WAITING_FOR_PULLBACK", "ENTRY_READY", "SIGNAL_ACTIVE",
    }
    assert result.state in known_states
    if result.signal is not None:
        assert result.signal.direction in ("buy", "sell")
        assert result.signal.stop_loss != result.signal.entry


def test_signal_has_positive_risk_when_present():
    candles = make_synthetic_level_setup()
    result = evaluate(candles, DEFAULT_CONFIG)
    if result.signal and result.signal.direction == "buy":
        assert result.signal.take_profit > result.signal.entry > result.signal.stop_loss
    if result.signal and result.signal.direction == "sell":
        assert result.signal.take_profit < result.signal.entry < result.signal.stop_loss
