from __future__ import annotations

from app.repositories.support_repository import SupportRepository


def test_create_message_invalidates_cache(db_session, monkeypatch):
    invalidated = []

    def fake_invalidate(key: str) -> None:
        invalidated.append(key)

    monkeypatch.setattr("app.repositories.support_repository.invalidate_key", fake_invalidate)

    repo = SupportRepository(db_session)
    conv = repo.create_conversation(conversation_id="c1", customer_user_id=1, source_session_id=None, priority="low")
    repo.create_message(message_id="m1", conversation_id=conv.conversation_id, sender_user_id=1, sender_role="customer", body="hello")

    assert "support:queue:unread" in invalidated


def test_close_conversation_invalidates_cache(db_session, monkeypatch):
    invalidated = []

    def fake_invalidate(key: str) -> None:
        invalidated.append(key)

    monkeypatch.setattr("app.repositories.support_repository.invalidate_key", fake_invalidate)

    repo = SupportRepository(db_session)
    conv = repo.create_conversation(conversation_id="c2", customer_user_id=2, source_session_id=None, priority="low")
    repo.close_conversation(conversation_id=conv.conversation_id)

    assert "support:queue:unread" in invalidated
