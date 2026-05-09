from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RefundRequest(Base):
    __tablename__ = "refund_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    refund_request_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    order_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    reason_code: Mapped[str] = mapped_column(String(64), nullable=False)
    simulation_scenario_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default")

    status: Mapped[str] = mapped_column(String(32), nullable=False, default="submitted")
    status_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    policy_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    policy_reference: Mapped[str | None] = mapped_column(String(128), nullable=True)
    resolution_action: Mapped[str | None] = mapped_column(String(32), nullable=True)
    decision_reason_codes: Mapped[str | None] = mapped_column(Text, nullable=True)
    refundable_amount_currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    refundable_amount_value: Mapped[float | None] = mapped_column(nullable=True)
    explanation_template_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    explanation_params_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False
    )
