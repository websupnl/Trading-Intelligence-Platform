from app.services.regime_detector import _classify


def test_regime_classifies_crisis_on_extreme_vix():
    regime, confidence, notes = _classify({"vix": 45.0})
    assert regime == "crisis"
    assert confidence == 0.90
    assert "VIX" in notes


def test_regime_uses_credit_dollar_and_btc_dominance_for_risk_on():
    regime, confidence, notes = _classify({
        "vix": 14.0,
        "spy": {"vs_ema50": 3.0, "vs_ema200": 6.0, "data_points": 220},
        "btc": {"vs_ema50": 2.0, "data_points": 120},
        "credit": {"vs_ema50": 0.4, "data_points": 220},
        "dollar": {"trend": "down", "data_points": 80},
        "btc_dominance": 49.0,
    })
    assert regime == "risk_on"
    assert confidence >= 0.8
    assert "HYG/LQD" in notes
    assert "Dollar zwakker" in notes


def test_regime_uses_credit_dollar_and_btc_dominance_for_risk_off():
    regime, confidence, notes = _classify({
        "vix": 29.0,
        "spy": {"vs_ema50": -2.0, "vs_ema200": -4.0, "data_points": 220},
        "btc": {"vs_ema50": -3.0, "data_points": 120},
        "credit": {"vs_ema50": -1.5, "data_points": 220},
        "dollar": {"trend": "up", "data_points": 80},
        "btc_dominance": 61.0,
    })
    assert regime == "risk_off"
    assert confidence >= 0.8
    assert "credit risk-off" in notes
    assert "Dollar sterker" in notes
