from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.repositories.order_repository import OrderRepository
from app.repositories.refund_repository import RefundRepository
from app.repositories.support_repository import SupportRepository
from app.repositories.user_repository import UserRepository
from app.services.account_order_service import AccountOrderService
from app.services.notification_service import NotificationService, _LAST_NOTIFIED_STATUSES


TEST_DATABASE_URL = "sqlite+pysqlite:///:memory:"


def build_session() -> Session:
    engine = create_engine(TEST_DATABASE_URL)
    Base.metadata.create_all(bind=engine)
    local_session = sessionmaker(bind=engine, autocommit=False, autoflush=False, class_=Session)
    return local_session()


def test_live_notifications_emit_once_per_status() -> None:
    _LAST_NOTIFIED_STATUSES.clear()
    session = build_session()
    try:
        user_repo = UserRepository(session)
        user = user_repo.create_registered(email="notify@example.com", password_hash="hash")

        order_repo = OrderRepository(session)
        order = order_repo.create(order_id="ord-notify", user_id=user.id)
        order.created_at = datetime.now(UTC) - timedelta(hours=2)
        order.updated_at = order.created_at
        session.commit()

        account_order_service = AccountOrderService(order_repo, user_repo)
        notification_service = NotificationService(
            account_order_service=account_order_service,
            refund_repository=RefundRepository(session),
            support_repository=SupportRepository(session),
        )

        first_batch = notification_service.get_live_notifications(user)
        second_batch = notification_service.get_live_notifications(user)

        assert len(first_batch) == 1
        assert first_batch[0].order_id == "ord-notify"
        assert first_batch[0].status == "delivered"
        assert second_batch == []
    finally:
        session.close()