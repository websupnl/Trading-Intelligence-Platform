from app.services.ai_guard import is_ai_failure, pause_minutes_for_error


def test_credit_balance_error_is_ai_failure():
    exc = Exception("Your credit balance is too low to access the Anthropic API.")
    assert is_ai_failure(exc) is True
    assert pause_minutes_for_error(exc) == 360


def test_rate_limit_error_uses_shorter_pause():
    exc = Exception("anthropic rate_limit_error 429")
    assert is_ai_failure(exc) is True
    assert pause_minutes_for_error(exc) == 30


def test_unrelated_error_is_not_ai_failure():
    assert is_ai_failure(Exception("database connection timeout")) is False
