import pytest
from app.services.risk_engine import RiskEngine
from app.schemas.risk import RiskCheckRequest


@pytest.fixture
def engine():
    return RiskEngine()


@pytest.fixture(autouse=True)
def use_config_fallback_for_runtime_state(monkeypatch):
    import app.services.risk_engine as re_module
    monkeypatch.setattr(re_module, "get_runtime_value", lambda _key, default: default)


def test_kill_switch_blocks_all(engine, monkeypatch):
    import app.services.risk_engine as re_module
    monkeypatch.setattr(re_module.settings, "kill_switch_enabled", True)
    req = RiskCheckRequest(symbol="AAPL", side="buy", quantity=10, mode="paper")
    result = engine.check(req)
    assert result.approved is False
    assert result.blocked_by_rule == "kill_switch"


def test_live_trading_blocked(engine, monkeypatch):
    import app.services.risk_engine as re_module
    monkeypatch.setattr(re_module.settings, "live_trading_enabled", False)
    monkeypatch.setattr(re_module.settings, "kill_switch_enabled", False)
    req = RiskCheckRequest(symbol="AAPL", side="buy", quantity=10, mode="live")
    result = engine.check(req)
    assert result.approved is False
    assert "live" in result.blocked_by_rule


def test_max_position_size(engine, monkeypatch):
    import app.services.risk_engine as re_module
    monkeypatch.setattr(re_module.settings, "kill_switch_enabled", False)
    monkeypatch.setattr(re_module.settings, "live_trading_enabled", False)
    req = RiskCheckRequest(symbol="AAPL", side="buy", quantity=1, estimated_notional=99999, mode="paper")
    result = engine.check(req)
    assert result.approved is False
    assert result.blocked_by_rule == "max_position_size"


def test_low_confidence_blocked(engine, monkeypatch):
    import app.services.risk_engine as re_module
    monkeypatch.setattr(re_module.settings, "kill_switch_enabled", False)
    monkeypatch.setattr(re_module.settings, "live_trading_enabled", False)
    req = RiskCheckRequest(symbol="AAPL", side="buy", quantity=1, confidence=0.2, mode="paper")
    result = engine.check(req)
    assert result.approved is False


def test_paper_mode_approved(engine, monkeypatch):
    import app.services.risk_engine as re_module
    monkeypatch.setattr(re_module.settings, "kill_switch_enabled", False)
    monkeypatch.setattr(re_module.settings, "live_trading_enabled", False)
    monkeypatch.setattr(re_module.settings, "require_manual_confirmation", False)
    req = RiskCheckRequest(symbol="AAPL", side="buy", quantity=1, estimated_notional=100, confidence=0.8, mode="paper")
    result = engine.check(req)
    assert result.approved is True


def test_notional_order_without_quantity_is_allowed(engine, monkeypatch):
    import app.services.risk_engine as re_module
    monkeypatch.setattr(re_module.settings, "kill_switch_enabled", False)
    monkeypatch.setattr(re_module.settings, "live_trading_enabled", False)
    monkeypatch.setattr(re_module.settings, "require_manual_confirmation", False)
    req = RiskCheckRequest(symbol="AAPL", side="buy", estimated_notional=100, confidence=0.8, mode="paper")
    result = engine.check(req)
    assert result.approved is True
