from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from enum import Enum

from app.core.errors import ForbiddenError, NotFoundError
from app.core.errors import ConflictError
from app.models.user import User
from app.repositories.order_repository import OrderRepository
from app.repositories.refund_repository import RefundRepository
from app.repositories.user_repository import UserRepository
from app.services.refund_policy_engine import RefundPolicyEngine
from app.schemas.refund import (
    ManualReviewDecision,
    RefundDecisionReasonCode,
    ManualReviewEscalationStatus,
    ManualReviewHandoff,
    ManualReviewQueueItem,
    ManualReviewQueueResponse,
    MoneyAmount,
    OrderStateSimResponse,
    RefundCreateRequest,
    RefundEligibilityCheckRequest,
    RefundEligibilityCheckResponse,
    RefundPolicyVersion,
    RefundReasonCode,
    RefundRequestListResponse,
    RefundRequestStatus,
    RefundResolutionAction,
    RefundRequestResponse,
)


class RefundService:
    MANUAL_REVIEW_QUEUE_NAME = "refund-risk-review"
    MANUAL_REVIEW_SLA_HOURS = 24
    _LEGACY_REASON_CODE_MAP: dict[str, str] = {
        "outcome_mismatch": RefundDecisionReasonCode.REASON_CODE_NOT_SUPPORTED.value,
    }
    _VALID_REFUND_REASON_CODES: set[str] = {code.value for code in RefundReasonCode}
    _VALID_POLICY_VERSIONS: set[str] = {code.value for code in RefundPolicyVersion}

    def __init__(
        self,
        order_repository: OrderRepository,
        refund_repository: RefundRepository,
        user_repository: UserRepository,
        refund_window_hours: int = 48,
    ) -> None:
        self.order_repository = order_repository
        self.refund_repository = refund_repository
        self.user_repository = user_repository
        self.policy_engine = RefundPolicyEngine()
        self.refund_window_hours = max(1, refund_window_hours)

    def check_eligibility(self, *, user: User, payload: RefundEligibilityCheckRequest) -> RefundEligibilityCheckResponse:
        order = self._get_owned_order(user=user, order_id=payload.order_id)
        simulated_state = self._simulate_order_state(
            order_id=order.order_id,
            scenario_id=payload.simulation_scenario_id,
            payment_state=order.payment_state,
        )

        decision = self.policy_engine.evaluate(
            reason_code=payload.reason_code,
            simulation_scenario_id=payload.simulation_scenario_id,
            fulfillment_state=simulated_state["fulfillment_state"],
            payment_state=simulated_state["payment_state"],
            refund_window_hours=self.refund_window_hours,
            order_age_hours=self._calculate_order_age_hours(order),
        )
        refundable_amount_value = self._compute_refundable_amount(order_total_cents=order.total_cents, refund_ratio=decision.refundable_ratio)
        explanation_params = dict(decision.explanation_params)
        explanation_params["order_total_cents"] = order.total_cents or 0
        explanation_params["refundable_amount"] = refundable_amount_value

        return RefundEligibilityCheckResponse(
            eligible=decision.eligible,
            resolution_action=decision.resolution_action,
            decision_reason_codes=decision.decision_reason_codes,
            explanation_template_key=decision.explanation_template_key,
            explanation_params=explanation_params,
            policy_version=decision.policy_version,
            policy_reference=decision.policy_reference,
            refundable_amount=MoneyAmount(currency="USD", value=refundable_amount_value),
            simulated_state=simulated_state["fulfillment_state"],
        )

    def create_request(
        self,
        *,
        user: User,
        payload: RefundCreateRequest,
        idempotency_key: str | None,
    ) -> RefundRequestResponse:
        order = self._get_owned_order(user=user, order_id=payload.order_id)
        stable_key = idempotency_key or self._build_idempotency_key(
            user_id=user.id,
            order_id=payload.order_id,
            reason_code=payload.reason_code,
            scenario_id=payload.simulation_scenario_id,
        )

        existing = self.refund_repository.get_by_idempotency_key(stable_key)
        if existing is not None:
            return RefundRequestResponse(
                refund_request_id=existing.refund_request_id,
                order_id=existing.order_id,
                reason_code=self._normalize_refund_reason_code(existing.reason_code),
                status=existing.status,
                status_reason=existing.status_reason,
                manual_review_handoff=self._build_manual_review_handoff_from_row(existing),
                decision_reason_codes=self._parse_decision_reason_codes(existing.decision_reason_codes),
                policy_version=self._normalize_policy_version(existing.policy_version),
                policy_reference=existing.policy_reference,
                resolution_action=existing.resolution_action,
                refundable_amount_currency=existing.refundable_amount_currency,
                refundable_amount_value=existing.refundable_amount_value,
                explanation_template_key=existing.explanation_template_key,
                explanation_params=json.loads(existing.explanation_params_json) if existing.explanation_params_json else None,
                created_at=existing.created_at,
                idempotent_replay=True,
            )

        duplicate_for_order = self.refund_repository.get_by_user_order(user_id=user.id, order_id=order.order_id)
        if duplicate_for_order is not None:
            raise ConflictError(
                "Refund already requested for this order",
                details={
                    "conflict_type": "duplicate_refund_request",
                    "order_id": order.order_id,
                },
            )

        eligibility = self.check_eligibility(
            user=user,
            payload=RefundEligibilityCheckRequest(
                order_id=payload.order_id,
                reason_code=payload.reason_code,
                item_selections=payload.item_selections,
                simulation_scenario_id=payload.simulation_scenario_id,
            ),
        )
        manual_review_handoff = self._build_manual_review_handoff(
            user_id=user.id,
            order_id=order.order_id,
            reason_code=payload.reason_code,
            simulation_scenario_id=payload.simulation_scenario_id,
            eligibility=eligibility,
        )

        status = RefundRequestStatus.SUBMITTED if eligibility.eligible else RefundRequestStatus.DENIED
        if manual_review_handoff is not None:
            status = RefundRequestStatus.PENDING_MANUAL_REVIEW
        status_reason = None if eligibility.eligible else ",".join(eligibility.decision_reason_codes)

        request_id = hashlib.sha256(
            f"{stable_key}:{order.order_id}:{payload.reason_code}".encode("utf-8")
        ).hexdigest()[:16]

        created = self.refund_repository.create(
            refund_request_id=request_id,
            idempotency_key=stable_key,
            user_id=user.id,
            order_id=order.order_id,
            reason_code=payload.reason_code,
            simulation_scenario_id=payload.simulation_scenario_id,
            status=status,
            status_reason=status_reason,
            policy_version=eligibility.policy_version,
            policy_reference=eligibility.policy_reference,
            resolution_action=eligibility.resolution_action,
            decision_reason_codes=",".join(eligibility.decision_reason_codes),
            refundable_amount_currency=eligibility.refundable_amount.currency,
            refundable_amount_value=eligibility.refundable_amount.value,
            explanation_template_key=eligibility.explanation_template_key,
            explanation_params_json=json.dumps(
                self._serialize_explanation_params(eligibility.explanation_params),
                separators=(",", ":"),
                sort_keys=True,
            ),
            escalation_status=manual_review_handoff.escalation_status if manual_review_handoff else None,
            escalation_queue_name=manual_review_handoff.queue_name if manual_review_handoff else None,
            escalation_sla_deadline_at=manual_review_handoff.sla_deadline_at if manual_review_handoff else None,
            escalation_payload_json=(
                json.dumps(manual_review_handoff.payload, separators=(",", ":"), sort_keys=True)
                if manual_review_handoff
                else None
            ),
        )

        if created.status == RefundRequestStatus.SUBMITTED:
            self.user_repository.credit_balance(
                user_id=created.user_id,
                amount_cents=self._money_value_to_cents(created.refundable_amount_value),
            )

        return RefundRequestResponse(
            refund_request_id=created.refund_request_id,
            order_id=created.order_id,
            reason_code=self._normalize_refund_reason_code(created.reason_code),
            status=created.status,
            status_reason=created.status_reason,
            manual_review_handoff=manual_review_handoff,
            decision_reason_codes=self._parse_decision_reason_codes(created.decision_reason_codes),
            policy_version=self._normalize_policy_version(created.policy_version),
            policy_reference=created.policy_reference,
            resolution_action=created.resolution_action,
            refundable_amount_currency=created.refundable_amount_currency,
            refundable_amount_value=created.refundable_amount_value,
            explanation_template_key=created.explanation_template_key,
            explanation_params=json.loads(created.explanation_params_json) if created.explanation_params_json else None,
            created_at=created.created_at,
            idempotent_replay=False,
        )

    def get_request(self, *, user: User, refund_request_id: str) -> RefundRequestResponse:
        row = self.refund_repository.get_by_refund_request_id(refund_request_id)
        if row is None:
            raise NotFoundError("Refund request not found")
        if row.user_id != user.id:
            raise ForbiddenError("Refund request does not belong to current user")

        return self._build_refund_response_from_row(row)

    def list_user_refund_requests(
        self,
        *,
        user: User,
        limit: int,
        offset: int,
        status: str | None = None,
        query: str | None = None,
    ) -> RefundRequestListResponse:
        if user.is_guest:
            return RefundRequestListResponse(items=[], total=0, limit=limit, offset=offset)

        statuses = self._normalize_status_filter(status)
        normalized_query = query.strip() if query and query.strip() else None
        rows = self.refund_repository.list_by_user_id(
            user_id=user.id,
            limit=limit,
            offset=offset,
            statuses=statuses,
            query=normalized_query,
        )
        total = self.refund_repository.count_by_user_id(
            user_id=user.id,
            statuses=statuses,
            query=normalized_query,
        )
        return RefundRequestListResponse(
            items=[self._build_refund_response_from_row(row) for row in rows],
            total=total,
            limit=limit,
            offset=offset,
        )

    @staticmethod
    def _normalize_status_filter(status: str | None) -> list[str] | None:
        if status is None:
            return None

        normalized = status.strip().lower()
        if not normalized:
            return None
        if normalized == "approved":
            return [RefundRequestStatus.SUBMITTED.value, RefundRequestStatus.RESOLVED.value]
        if normalized in {
            RefundRequestStatus.SUBMITTED.value,
            RefundRequestStatus.DENIED.value,
            RefundRequestStatus.PENDING_MANUAL_REVIEW.value,
            RefundRequestStatus.RESOLVED.value,
        }:
            return [normalized]
        return None

    def list_manual_review_queue(
        self,
        *,
        limit: int = 50,
        before_sla: datetime | None = None,
    ) -> ManualReviewQueueResponse:
        rows = self.refund_repository.list_pending_manual_review(limit=limit, before_sla=before_sla)
        items = [self._build_manual_review_queue_item(row) for row in rows if row.escalation_status is not None]
        return ManualReviewQueueResponse(items=items, total=len(items))

    def claim_manual_review_request(self, *, refund_request_id: str, admin_user_id: int) -> RefundRequestResponse:
        row = self.refund_repository.get_by_refund_request_id(refund_request_id)
        if row is None:
            raise NotFoundError("Refund request not found")
        transitioned = self.refund_repository.transition_escalation_status(
            refund_request_id=refund_request_id,
            to_status=ManualReviewEscalationStatus.IN_REVIEW,
            actor_admin_user_id=admin_user_id,
        )
        if transitioned is None:
            raise ConflictError("Refund request cannot be claimed in current state")
        return self._build_refund_response_from_row(transitioned)

    def decide_manual_review_request(
        self,
        *,
        refund_request_id: str,
        decision: ManualReviewDecision,
        reviewer_note: str | None,
        admin_user_id: int,
    ) -> RefundRequestResponse:
        row = self.refund_repository.get_by_refund_request_id(refund_request_id)
        if row is None:
            raise NotFoundError("Refund request not found")
        transitioned = self.refund_repository.transition_escalation_status(
            refund_request_id=refund_request_id,
            to_status=decision,
            actor_admin_user_id=admin_user_id,
            reviewer_note=reviewer_note,
        )
        if transitioned is None:
            raise ConflictError("Refund request cannot be decided in current state")
        if transitioned.status == RefundRequestStatus.RESOLVED:
            self.user_repository.credit_balance(
                user_id=transitioned.user_id,
                amount_cents=self._money_value_to_cents(transitioned.refundable_amount_value),
            )
        return self._build_refund_response_from_row(transitioned)

    def get_order_state_sim(self, *, user: User, order_id: str, scenario_id: str) -> OrderStateSimResponse:
        order = self._get_owned_order(user=user, order_id=order_id)
        simulated = self._simulate_order_state(
            order_id=order.order_id,
            scenario_id=scenario_id,
            payment_state=order.payment_state,
        )

        now = order.updated_at.astimezone(UTC)
        timeline = [
            {"state": "accepted", "timestamp": (now - timedelta(minutes=30)).isoformat()},
            {"state": "preparing", "timestamp": (now - timedelta(minutes=20)).isoformat()},
            {"state": simulated["fulfillment_state"], "timestamp": now.isoformat()},
        ]
        return OrderStateSimResponse(
            order_id=order.order_id,
            simulation_scenario_id=scenario_id,
            fulfillment_state=simulated["fulfillment_state"],
            payment_state=simulated["payment_state"],
            state_timeline=timeline,
        )

    def _get_owned_order(self, *, user: User, order_id: str):
        if user.is_guest:
            raise ForbiddenError("Guest users cannot submit refund actions")
        order = self.order_repository.get_by_order_id(order_id)
        if order is None:
            raise NotFoundError("Order not found")
        if order.user_id != user.id:
            raise ForbiddenError("Order does not belong to current user")
        return order

    @staticmethod
    def _build_idempotency_key(*, user_id: int, order_id: str, reason_code: str, scenario_id: str) -> str:
        raw = f"{user_id}:{order_id}:{reason_code}:{scenario_id}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]

    @staticmethod
    def _simulate_order_state(*, order_id: str, scenario_id: str, payment_state: str | None) -> dict[str, str]:
        del order_id
        resolved_payment_state = payment_state or "captured"

        # Keep refund outcomes deterministic for user-facing flows.
        delivered_scenarios = {
            "default",
            "delivered-happy",
            "on_time",
            "late_delivery",
            "missing_item",
            "wrong_item",
            "quality_issue",
        }
        if scenario_id in delivered_scenarios:
            return {"fulfillment_state": "delivered", "payment_state": resolved_payment_state}
        if scenario_id == "payment-pending":
            return {"fulfillment_state": "delivered", "payment_state": "pending"}
        if scenario_id == "expired-window":
            return {"fulfillment_state": "delivered", "payment_state": resolved_payment_state}

        return {"fulfillment_state": "preparing", "payment_state": resolved_payment_state}

    @staticmethod
    def _serialize_explanation_params(params: dict[str, str | int | float | bool]) -> dict[str, str | int | float | bool]:
        serialized: dict[str, str | int | float | bool] = {}
        for key, value in params.items():
            if isinstance(value, Enum):
                serialized[key] = str(value.value)
            else:
                serialized[key] = value
        return serialized

    def _build_manual_review_handoff(
        self,
        *,
        user_id: int,
        order_id: str,
        reason_code: str,
        simulation_scenario_id: str,
        eligibility: RefundEligibilityCheckResponse,
    ) -> ManualReviewHandoff | None:
        if eligibility.resolution_action != RefundResolutionAction.MANUAL_REVIEW:
            return None

        created_at = datetime.now(UTC)
        return ManualReviewHandoff(
            escalation_status=ManualReviewEscalationStatus.QUEUED,
            queue_name=self.MANUAL_REVIEW_QUEUE_NAME,
            sla_deadline_at=created_at + timedelta(hours=self.MANUAL_REVIEW_SLA_HOURS),
            payload={
                "user_id": user_id,
                "order_id": order_id,
                "reason_code": self._serialize_scalar(reason_code),
                "simulation_scenario_id": simulation_scenario_id,
                "decision_reason_codes": ",".join(eligibility.decision_reason_codes),
                "policy_version": self._serialize_scalar(eligibility.policy_version),
                "policy_reference": eligibility.policy_reference,
                "resolution_action": self._serialize_scalar(eligibility.resolution_action),
                "refundable_amount": eligibility.refundable_amount.value,
                "currency": eligibility.refundable_amount.currency,
                "explanation_template_key": eligibility.explanation_template_key,
            },
        )

    @staticmethod
    def _build_manual_review_handoff_from_row(row) -> ManualReviewHandoff | None:
        if row.escalation_status is None:
            return None
        payload_raw = row.escalation_payload_json or "{}"
        payload = json.loads(payload_raw)
        return ManualReviewHandoff(
            escalation_status=row.escalation_status,
            queue_name=row.escalation_queue_name,
            sla_deadline_at=row.escalation_sla_deadline_at,
            payload=payload,
            claimed_by_admin_user_id=row.claimed_by_admin_user_id,
            claimed_at=row.claimed_at,
            decided_by_admin_user_id=row.decided_by_admin_user_id,
            decided_at=row.decided_at,
            reviewer_note=row.reviewer_note,
        )

    def _build_manual_review_queue_item(self, row) -> ManualReviewQueueItem:
        handoff = self._build_manual_review_handoff_from_row(row)
        if handoff is None:
            raise ValueError("Expected manual-review handoff data")
        return ManualReviewQueueItem(
            refund_request_id=row.refund_request_id,
            order_id=row.order_id,
            status=row.status,
            created_at=row.created_at,
            handoff=handoff,
        )

    def _build_refund_response_from_row(self, row) -> RefundRequestResponse:
        return RefundRequestResponse(
            refund_request_id=row.refund_request_id,
            order_id=row.order_id,
            reason_code=self._normalize_refund_reason_code(row.reason_code),
            status=row.status,
            status_reason=row.status_reason,
            manual_review_handoff=self._build_manual_review_handoff_from_row(row),
            decision_reason_codes=self._parse_decision_reason_codes(row.decision_reason_codes),
            policy_version=self._normalize_policy_version(row.policy_version),
            policy_reference=row.policy_reference,
            resolution_action=row.resolution_action,
            refundable_amount_currency=row.refundable_amount_currency,
            refundable_amount_value=row.refundable_amount_value,
            explanation_template_key=row.explanation_template_key,
            explanation_params=json.loads(row.explanation_params_json) if row.explanation_params_json else None,
            created_at=row.created_at,
            idempotent_replay=False,
        )

    @staticmethod
    def _serialize_scalar(value: str | int | float | bool | Enum) -> str | int | float | bool:
        if isinstance(value, Enum):
            return str(value.value)
        return value

    @staticmethod
    def _compute_refundable_amount(*, order_total_cents: int | None, refund_ratio: float) -> float:
        if not order_total_cents or order_total_cents <= 0:
            return 0.0
        computed_cents = round(order_total_cents * max(0.0, min(refund_ratio, 1.0)))
        return computed_cents / 100.0

    @staticmethod
    def _money_value_to_cents(value: float | None) -> int:
        if value is None:
            return 0
        return max(0, round(value * 100))

    @classmethod
    def _parse_decision_reason_codes(cls, raw_codes: str | None) -> list[str]:
        if not raw_codes:
            return []

        normalized_codes: list[str] = []
        valid_codes = {code.value for code in RefundDecisionReasonCode}
        for code in raw_codes.split(","):
            candidate = code.strip()
            if not candidate:
                continue
            if candidate in valid_codes:
                normalized_codes.append(candidate)
                continue

            mapped = cls._LEGACY_REASON_CODE_MAP.get(candidate)
            if mapped:
                normalized_codes.append(mapped)
                continue

            normalized_codes.append(RefundDecisionReasonCode.REASON_CODE_NOT_SUPPORTED.value)

        return normalized_codes

    @classmethod
    def _normalize_refund_reason_code(cls, reason_code: str | None) -> str:
        if reason_code and reason_code in cls._VALID_REFUND_REASON_CODES:
            return reason_code
        return RefundReasonCode.OTHER.value

    @classmethod
    def _normalize_policy_version(cls, policy_version: str | None) -> str | None:
        if not policy_version:
            return None
        if policy_version in cls._VALID_POLICY_VERSIONS:
            return policy_version
        return None

    @staticmethod
    def _calculate_order_age_hours(order) -> float:
        updated_at = order.updated_at.astimezone(UTC)
        age_seconds = (datetime.now(UTC) - updated_at).total_seconds()
        return max(0.0, age_seconds / 3600.0)
