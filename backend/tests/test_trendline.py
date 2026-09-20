from app.strategy.level_detector import support_trendline, _lower_hull


def test_lower_hull_excludes_points_above_line():
    # سه لمس روی یک خط صعودی + دو نقطهٔ بالاتر که نباید خط را خراب کنند
    points = [(0, 10.0), (5, 12.0), (10, 14.0), (3, 50.0), (7, 60.0)]
    hull = _lower_hull(points)
    hull_prices = [p[1] for p in hull]
    # نقاط دورافتادهٔ بالا (۵۰، ۶۰) نباید در hull پایینی باشند
    assert 50.0 not in hull_prices
    assert 60.0 not in hull_prices


def test_support_trendline_requires_min_touches():
    line, touches = support_trendline([(0, 10.0)], min_touches=2)
    assert line is None
    assert touches == 0


def test_support_trendline_on_perfect_line():
    points = [(0, 10.0), (10, 20.0), (20, 30.0)]
    line, touches = support_trendline(points, min_touches=2)
    assert line is not None
    assert touches >= 2
    a, b = line
    assert abs(a - 1.0) < 1e-6  # شیب ۱ برای این خط کاملاً صاف
