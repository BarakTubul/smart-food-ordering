from __future__ import annotations

from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.order import Order


class OrderRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_order_id(self, order_id: str) -> Order | None:
        stmt = select(Order).where(Order.order_id == order_id)
        return self.db.scalar(stmt)

    def create(
        self,
        *,
        order_id: str,
        user_id: int,
        status: str = "confirmed",
        status_label: str = "Confirmed",
        payment_state: str = "captured",
        ordered_items_summary: str | None = None,
        total_cents: int | None = None,
        eta_from=None,
        eta_to=None,
    ) -> Order:
        order = Order(
            order_id=order_id,
            user_id=user_id,
            status=status,
            status_label=status_label,
            payment_state=payment_state,
            ordered_items_summary=ordered_items_summary,
            total_cents=total_cents,
            eta_from=eta_from,
            eta_to=eta_to,
        )
        self.db.add(order)
        self.db.commit()
        self.db.refresh(order)
        return order

    def list_by_user(self, user_id: int, *, limit: int, offset: int) -> list[Order]:
        stmt = (
            select(Order)
            .where(Order.user_id == user_id)
            .order_by(Order.created_at.desc())
            .offset(max(0, offset))
            .limit(max(1, limit))
        )
        return list(self.db.scalars(stmt))

    def count_by_user(self, user_id: int) -> int:
        stmt = select(func.count()).select_from(Order).where(Order.user_id == user_id)
        return int(self.db.scalar(stmt) or 0)
