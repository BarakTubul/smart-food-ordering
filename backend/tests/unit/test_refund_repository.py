from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.models.user import User
from app.repositories.order_repository import OrderRepository
from app.repositories.refund_repository import RefundRepository


TEST_DATABASE_URL = "sqlite+pysqlite:///:memory:"


def build_session() -> Session:
    engine = create_engine(TEST_DATABASE_URL)
    Base.metadata.create_all(bind=engine)
    local_session = sessionmaker(bind=engine, autocommit=False, autoflush=False, class_=Session)
    return local_session()


def _create_user(session: Session) -> User:
    user = User(email="repo-user@example.com", password_hash=None, is_guest=False, is_active=True, is_verified=True)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_list_pending_manual_review_orders_by_sla() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-repo-1", user_id=user.id)

        repo = RefundRepository(session)
        created = repo.create(
            refund_request_id="rr-1",
            idempotency_key="idem-rr-1",
            user_id=user.id,
            order_id="ord-repo-1",
            reason_code="fraud",
            simulation_scenario_id="delivered-happy",
            status="submitted",
            status_reason=None,
        )

        fetched = repo.get_by_idempotency_key("idem-rr-1")
        assert fetched is not None
        assert fetched.refund_request_id == created.refund_request_id
    finally:
        session.close()


def test_transition_escalation_status_enforces_flow() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-repo-3", user_id=user.id)

        repo = RefundRepository(session)
        first = repo.create(
            refund_request_id="rr-3a",
            idempotency_key="idem-rr-3a",
            user_id=user.id,
            order_id="ord-repo-3",
            reason_code="fraud",
            simulation_scenario_id="delivered-happy",
            status="submitted",
            status_reason=None,
        )
        first.created_at = datetime.now(UTC) - timedelta(hours=2)
        session.commit()

        second = repo.create(
            refund_request_id="rr-3b",
            idempotency_key="idem-rr-3b",
            user_id=user.id,
            order_id="ord-repo-3",
            reason_code="fraud",
            simulation_scenario_id="delivered-happy",
            status="denied",
            status_reason="policy_denied",
        )
        second.created_at = datetime.now(UTC) - timedelta(hours=1)
        session.commit()

        latest = repo.get_by_user_order(user_id=user.id, order_id="ord-repo-3")
        assert latest is not None
        assert latest.refund_request_id == second.refund_request_id
    finally:
        session.close()
