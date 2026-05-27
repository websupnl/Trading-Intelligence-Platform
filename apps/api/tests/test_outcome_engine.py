from types import SimpleNamespace

import pytest

from app.services.outcome_engine import calculate_excursions, price_return_pct, signed_return_pct


def test_long_and_short_returns_are_scored_in_trade_direction():
    assert price_return_pct(100, 110) == pytest.approx(10)
    assert signed_return_pct(100, 110, "buy") == pytest.approx(10)
    assert signed_return_pct(100, 110, "sell") == pytest.approx(-10)
    assert signed_return_pct(100, 90, "short") == pytest.approx(10)


def test_excursions_use_high_and_low_for_long_signal():
    bars = [
        SimpleNamespace(high=108, low=96),
        SimpleNamespace(high=112, low=94),
    ]
    mfe, mae = calculate_excursions(100, bars, "buy")
    assert mfe == pytest.approx(12)
    assert mae == pytest.approx(-6)


def test_excursions_reverse_for_short_signal():
    bars = [
        SimpleNamespace(high=104, low=93),
        SimpleNamespace(high=110, low=88),
    ]
    mfe, mae = calculate_excursions(100, bars, "sell")
    assert mfe == pytest.approx(12)
    assert mae == pytest.approx(-10)
