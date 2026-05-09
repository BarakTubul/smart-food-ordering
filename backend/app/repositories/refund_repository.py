from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.refund_request import RefundRequest


class RefundRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_refund_request_id(self, refund_request_id: str) -> RefundRequest | None:
        stmt = select(RefundRequest).where(RefundRequest.refund_request_id == refund_request_id)
        return self.db.scalar(stmt)

    def get_by_idempotency_key(self, idempotency_key: str) -> RefundRequest | None:
        stmt = select(RefundRequest).where(RefundRequest.idempotency_key == idempotency_key)
        return self.db.scalar(stmt)

    def get_by_user_order(self, *, user_id: int, order_id: str) -> RefundRequest | None:
        stmt = (
            select(RefundRequest)
            .where(RefundRequest.user_id == user_id, RefundRequest.order_id == order_id)
            .order_by(RefundRequest.created_at.desc())
        )
        return self.db.scalar(stmt)

    def list_by_user_id(
        self,
        *,
        user_id: int,
        limit: int,
        offset: int,
        statuses: list[str] | None = None,
        query: str | None = None,
    ) -> list[RefundRequest]:
        stmt = select(RefundRequest).where(RefundRequest.user_id == user_id)
        if statuses:
            stmt = stmt.where(RefundRequest.status.in_(statuses))
        if query:
            like_query = f"%{query.strip()}%"
            stmt = stmt.where(RefundRequest.order_id.ilike(like_query))

        stmt = stmt.order_by(RefundRequest.created_at.desc()).offset(max(0, offset)).limit(max(1, limit))
        return list(self.db.scalars(stmt).all())

    def count_by_user_id(
        self,
        *,
        user_id: int,
        statuses: list[str] | None = None,
        query: str | None = None,
    ) -> int:
        stmt = select(func.count()).select_from(RefundRequest).where(RefundRequest.user_id == user_id)
        if statuses:
            stmt = stmt.where(RefundRequest.status.in_(statuses))
        if query:
            like_query = f"%{query.strip()}%"
            stmt = stmt.where(RefundRequest.order_id.ilike(like_query))
        return int(self.db.scalar(stmt) or 0)

    def create(
        self,
        *,
        refund_request_id: str,
        idempotency_key: str,
        user_id: int,
        order_id: str,
        reason_code: str,
        simulation_scenario_id: str,
        status: str,
        status_reason: str | None,
        policy_version: str | None = None,
        policy_reference: str | None = None,
        resolution_action: str | None = None,
        decision_reason_codes: str | None = None,
        refundable_amount_currency: str | None = None,
        refundable_amount_value: float | None = None,
        explanation_template_key: str | None = None,
        explanation_params_json: str | None = None,
    ) -> RefundRequest:
        row = RefundRequest(
            refund_request_id=refund_request_id,
            idempotency_key=idempotency_key,
            user_id=user_id,
            order_id=order_id,
            reason_code=reason_code,
            simulation_scenario_id=simulation_scenario_id,
            status=status,
            status_reason=status_reason,
            policy_version=policy_version,
            policy_reference=policy_reference,
            resolution_action=resolution_action,
            decision_reason_codes=decision_reason_codes,
            refundable_amount_currency=refundable_amount_currency,
            refundable_amount_value=refundable_amount_value,
            explanation_template_key=explanation_template_key,
            explanation_params_json=explanation_params_json,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row
