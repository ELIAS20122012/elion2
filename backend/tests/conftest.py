import pytest


@pytest.fixture(autouse=True)
def _no_ai_retry_wait(monkeypatch):
    """AI providers wait a few seconds between retries when busy; tests should not."""
    from journal import ai

    monkeypatch.setattr(ai, "_sleep", lambda s: None)
