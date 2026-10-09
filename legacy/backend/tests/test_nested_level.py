from app.strategy.indicators import Candle
from app.strategy.level_detector import find_all_levels
from app.strategy.indicators import macd
from app.strategy.config import DEFAULT_CONFIG
from tests.test_level_detector import make_synthetic_level_setup


def test_find_all_levels_tags_confirmed_by_correctly():
    candles = make_synthetic_level_setup()
    closes = [c.close for c in candles]
    macd_main = macd(closes, *DEFAULT_CONFIG.macd_main)
    macd_small = macd(closes, *DEFAULT_CONFIG.macd_small)

    main_levels = find_all_levels(candles, macd_main, DEFAULT_CONFIG, confirmed_by="main")
    small_levels = find_all_levels(candles, macd_small, DEFAULT_CONFIG, confirmed_by="small")

    for lv in main_levels:
        assert lv.confirmed_by == "main"
    for lv in small_levels:
        assert lv.confirmed_by == "small"
    # هر دو فراخوانی نباید کرش کنند، حتی اگر هیچ ساختاری پیدا نشود
    assert isinstance(main_levels, list)
    assert isinstance(small_levels, list)
