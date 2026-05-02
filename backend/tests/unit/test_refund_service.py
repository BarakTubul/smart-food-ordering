from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.errors import ForbiddenError
from app.db.base import Base
from app.models.user import User
from app.repositories.order_repository import OrderRepository
from app.repositories.refund_repository import RefundRepository
from app.repositories.user_repository import UserRepository
from app.services.refund_service import RefundService
from app.schemas.refund import (
    RefundCreateRequest,
    RefundDecisionReasonCode,
    RefundEligibilityCheckRequest,
    RefundPolicyVersion,
    RefundReasonCode,
    RefundRequestStatus,
    RefundResolutionAction,
)


TEST_DATABASE_URL = "sqlite+pysqlite:///:memory:"


def build_session() -> Session:
    engine = create_engine(TEST_DATABASE_URL)
    Base.metadata.create_all(bind=engine)
    local_session = sessionmaker(bind=engine, autocommit=False, autoflush=False, class_=Session)
    return local_session()


def _create_user(session: Session, *, is_guest: bool = False) -> User:
    user = User(email=None if is_guest else "u@example.com", password_hash=None, is_guest=is_guest, is_active=True, is_verified=not is_guest)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_eligibility_ineligible_for_expired_window() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        order_repo = OrderRepository(session)
        order = order_repo.create(order_id="ord-r-1", user_id=user.id, total_cents=2500)
        order.updated_at = datetime.now(UTC) - timedelta(hours=72)
        session.add(order)
        session.commit()

        service = RefundService(
            order_repository=order_repo,
            refund_repository=RefundRepository(session),
            user_repository=UserRepository(session),
            refund_window_hours=24,
        )
        response = service.check_eligibility(
            user=user,
            payload=RefundEligibilityCheckRequest(
                order_id="ord-r-1",
                reason_code=RefundReasonCode.LATE_DELIVERY,
                simulation_scenario_id="delivered-happy",
            ),
        )

        assert response.eligible is False
        assert response.resolution_action == RefundResolutionAction.DENY
        assert RefundDecisionReasonCode.REFUND_WINDOW_EXPIRED in response.decision_reason_codes
        assert response.explanation_template_key == "refund.refund_window_expired"
        assert response.explanation_params["refund_window_hours"] == 24
        assert response.policy_version == RefundPolicyVersion.V1
    finally:
        session.close()


def test_eligibility_partial_for_missing_item() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-r-4", user_id=user.id, total_cents=2400)

        service = RefundService(
            order_repository=order_repo,
            refund_repository=RefundRepository(session),
            user_repository=UserRepository(session),
        )
        response = service.check_eligibility(
            user=user,
            payload=RefundEligibilityCheckRequest(
                order_id="ord-r-4",
                reason_code=RefundReasonCode.MISSING_ITEM,
                simulation_scenario_id="delivered-happy",
            ),
        )

        assert response.eligible is True
        assert response.resolution_action == RefundResolutionAction.APPROVE_PARTIAL
        assert response.decision_reason_codes == [RefundDecisionReasonCode.ELIGIBLE_PARTIAL]
        assert response.explanation_template_key == "refund.reason_policy_outcome"
        assert response.explanation_params["submitted_reason"] == RefundReasonCode.MISSING_ITEM
        assert response.refundable_amount.value == 12.0
    finally:
        session.close()


def test_eligibility_denies_when_order_payment_not_captured() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-r-payment-1", user_id=user.id, total_cents=2400, payment_state="pending")

        service = RefundService(
            order_repository=order_repo,
            refund_repository=RefundRepository(session),
            user_repository=UserRepository(session),
        )
        response = service.check_eligibility(
            user=user,
            payload=RefundEligibilityCheckRequest(
                order_id="ord-r-payment-1",
                reason_code=RefundReasonCode.MISSING_ITEM,
                simulation_scenario_id="default",
            ),
        )

        assert response.eligible is False
        assert response.resolution_action == RefundResolutionAction.DENY
        assert RefundDecisionReasonCode.PAYMENT_NOT_CAPTURED in response.decision_reason_codes
    finally:
        session.close()


def test_create_request_idempotent_replay() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-r-2", user_id=user.id, total_cents=3000)
        service = RefundService(
            order_repository=order_repo,
            refund_repository=RefundRepository(session),
            user_repository=UserRepository(session),
        )

        payload = RefundCreateRequest(
            order_id="ord-r-2",
            reason_code=RefundReasonCode.MISSING_ITEM,
            simulation_scenario_id="default",
        )
        first = service.create_request(user=user, payload=payload, idempotency_key="idem-1")
        second = service.create_request(user=user, payload=payload, idempotency_key="idem-1")

        assert first.refund_request_id == second.refund_request_id
        assert first.idempotent_replay is False
        assert second.idempotent_replay is True

        stored = service.refund_repository.get_by_refund_request_id(first.refund_request_id)
        assert stored is not None
        assert stored.policy_version == RefundPolicyVersion.V1
        assert stored.policy_reference == "refund-policy-v1"
        assert stored.resolution_action == RefundResolutionAction.APPROVE_PARTIAL
        assert stored.decision_reason_codes == RefundDecisionReasonCode.ELIGIBLE_PARTIAL
        assert stored.refundable_amount_currency == "USD"
        assert stored.refundable_amount_value == 15.0
        assert stored.explanation_template_key == "refund.reason_policy_outcome"
        explanation_params = json.loads(stored.explanation_params_json or "{}")
        assert explanation_params["submitted_reason"] == RefundReasonCode.MISSING_ITEM
        assert explanation_params["resolution_action"] == RefundResolutionAction.APPROVE_PARTIAL
    finally:
        session.close()


def test_guest_cannot_submit_refund() -> None:
    session = build_session()
    try:
        guest = _create_user(session, is_guest=True)
        owner = _create_user(session)
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-r-3", user_id=owner.id, total_cents=2000)
        service = RefundService(
            order_repository=order_repo,
            refund_repository=RefundRepository(session),
            user_repository=UserRepository(session),
        )

        try:
            service.check_eligibility(
                user=guest,
                payload=RefundEligibilityCheckRequest(
                    order_id="ord-r-3",
                    reason_code=RefundReasonCode.LATE_DELIVERY,
                    simulation_scenario_id="default",
                ),
            )
            assert False, "Expected ForbiddenError"
        except ForbiddenError:
            assert True
    finally:
        session.close()


def test_create_request_manual_review_emits_handoff_contract() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-r-5", user_id=user.id, total_cents=2800)
        service = RefundService(
            order_repository=order_repo,
            refund_repository=RefundRepository(session),
            user_repository=UserRepository(session),
        )

        response = service.create_request(
            user=user,
            payload=RefundCreateRequest(
                order_id="ord-r-5",
                reason_code=RefundReasonCode.FRAUD,
                simulation_scenario_id="default",
            ),
            idempotency_key="idem-manual-review-1",
        )

        assert response.status == "pending_manual_review"
        assert response.manual_review_handoff is not None
        assert response.manual_review_handoff.escalation_status == "queued"
        assert response.manual_review_handoff.queue_name == "refund-risk-review"
        assert response.manual_review_handoff.payload["reason_code"] == RefundReasonCode.FRAUD.value
        assert response.manual_review_handoff.payload["resolution_action"] == RefundResolutionAction.MANUAL_REVIEW.value

        replay = service.create_request(
            user=user,
            payload=RefundCreateRequest(
                order_id="ord-r-5",
                reason_code=RefundReasonCode.FRAUD,
                simulation_scenario_id="default",
            ),
            idempotency_key="idem-manual-review-1",
        )
        assert replay.idempotent_replay is True
        assert replay.manual_review_handoff is not None
        assert replay.manual_review_handoff.escalation_status == "queued"
    finally:
        session.close()


def test_list_user_refund_requests_returns_newest_first() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-r-6", user_id=user.id, total_cents=2000)
        order_repo.create(order_id="ord-r-7", user_id=user.id, total_cents=3000)

        service = RefundService(
            order_repository=order_repo,
            refund_repository=RefundRepository(session),
            user_repository=UserRepository(session),
        )
        service.create_request(
            user=user,
            payload=RefundCreateRequest(
                order_id="ord-r-6",
                reason_code=RefundReasonCode.MISSING_ITEM,
                simulation_scenario_id="default",
            ),
            idempotency_key="idem-list-1",
        )
        service.create_request(
            user=user,
            payload=RefundCreateRequest(
                order_id="ord-r-7",
                reason_code=RefundReasonCode.QUALITY_ISSUE,
                simulation_scenario_id="default",
            ),
            idempotency_key="idem-list-2",
        )

        refunds = service.list_user_refund_requests(user=user, limit=50, offset=0)

        assert [refund.order_id for refund in refunds.items] == ["ord-r-7", "ord-r-6"]
        assert refunds.items[0].reason_code == RefundReasonCode.QUALITY_ISSUE
        assert refunds.items[1].reason_code == RefundReasonCode.MISSING_ITEM
    finally:
        session.close()


def test_create_request_credits_user_balance_for_auto_approved_refund() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        starting_balance = user.balance_cents
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-r-8", user_id=user.id, total_cents=2000)

        service = RefundService(
            order_repository=order_repo,
            refund_repository=RefundRepository(session),
            user_repository=UserRepository(session),
        )
        response = service.create_request(
            user=user,
            payload=RefundCreateRequest(
                order_id="ord-r-8",
                reason_code=RefundReasonCode.MISSING_ITEM,
                simulation_scenario_id="default",
            ),
            idempotency_key="idem-credit-1",
        )

        session.refresh(user)
        assert response.status == RefundRequestStatus.SUBMITTED
        assert user.balance_cents == starting_balance + 1000
    finally:
        session.close()


def test_list_user_refunds_normalizes_legacy_decision_reason_codes() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-r-legacy-1", user_id=user.id, total_cents=1800)

        refund_repo = RefundRepository(session)
        refund_repo.create(
            refund_request_id="legacy_refund_1",
            idempotency_key="legacy_idem_1",
            user_id=user.id,
            order_id="ord-r-legacy-1",
            reason_code=RefundReasonCode.OTHER,
            simulation_scenario_id="default",
            status=RefundRequestStatus.DENIED,
            status_reason="legacy",
            decision_reason_codes="outcome_mismatch",
        )

        service = RefundService(
            order_repository=order_repo,
            refund_repository=refund_repo,
            user_repository=UserRepository(session),
        )
        refunds = service.list_user_refund_requests(user=user, limit=50, offset=0)

        assert len(refunds.items) == 1
        assert refunds.items[0].decision_reason_codes == [RefundDecisionReasonCode.REASON_CODE_NOT_SUPPORTED]
    finally:
        session.close()


def test_list_user_refunds_normalizes_legacy_reason_code_and_policy_version() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-r-legacy-2", user_id=user.id, total_cents=1800)

        refund_repo = RefundRepository(session)
        refund_repo.create(
            refund_request_id="legacy_refund_2",
            idempotency_key="legacy_idem_2",
            user_id=user.id,
            order_id="ord-r-legacy-2",
            reason_code="chat_human_assistance",
            simulation_scenario_id="default",
            status=RefundRequestStatus.DENIED,
            status_reason="legacy",
            policy_version="chat",
            decision_reason_codes="outcome_mismatch",
        )

        service = RefundService(
            order_repository=order_repo,
            refund_repository=refund_repo,
            user_repository=UserRepository(session),
        )
        refunds = service.list_user_refund_requests(user=user, limit=50, offset=0)

        assert len(refunds.items) == 1
        assert refunds.items[0].reason_code == RefundReasonCode.OTHER
        assert refunds.items[0].policy_version is None
    finally:
        session.close()


def test_eligibility_default_scenario_treats_received_order_as_delivered() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-r-default-1", user_id=user.id, total_cents=2600, payment_state="captured")

        service = RefundService(
            order_repository=order_repo,
            refund_repository=RefundRepository(session),
            user_repository=UserRepository(session),
        )
        response = service.check_eligibility(
            user=user,
            payload=RefundEligibilityCheckRequest(
                order_id="ord-r-default-1",
                reason_code=RefundReasonCode.MISSING_ITEM,
                simulation_scenario_id="default",
            ),
        )

        assert response.eligible is True
        assert response.resolution_action == RefundResolutionAction.APPROVE_PARTIAL
        assert response.simulated_state == "delivered"
    finally:
        session.close()


def test_eligibility_denies_non_refundable_scenario() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-r-non-refundable-1", user_id=user.id, total_cents=2600)

        service = RefundService(
            order_repository=order_repo,
            refund_repository=RefundRepository(session),
            user_repository=UserRepository(session),
        )
        response = service.check_eligibility(
            user=user,
            payload=RefundEligibilityCheckRequest(
                order_id="ord-r-non-refundable-1",
                reason_code=RefundReasonCode.QUALITY_ISSUE,
                simulation_scenario_id="non-refundable",
            ),
        )

        assert response.eligible is False
        assert response.resolution_action == RefundResolutionAction.DENY
        assert response.decision_reason_codes == [RefundDecisionReasonCode.NON_REFUNDABLE_ITEM]
    finally:
        session.close()


def test_eligibility_denies_unsupported_reason_code_other() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-r-unsupported-1", user_id=user.id, total_cents=2600)

        service = RefundService(
            order_repository=order_repo,
            refund_repository=RefundRepository(session),
            user_repository=UserRepository(session),
        )
        response = service.check_eligibility(
            user=user,
            payload=RefundEligibilityCheckRequest(
                order_id="ord-r-unsupported-1",
                reason_code=RefundReasonCode.OTHER,
                simulation_scenario_id="default",
            ),
        )

        assert response.eligible is False
        assert response.resolution_action == RefundResolutionAction.DENY
        assert response.decision_reason_codes == [RefundDecisionReasonCode.REASON_CODE_NOT_SUPPORTED]
    finally:
        session.close()


def test_create_request_payment_pending_is_denied_and_does_not_credit_balance() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        starting_balance = user.balance_cents
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-r-payment-pending-1", user_id=user.id, total_cents=2200, payment_state="pending")

        service = RefundService(
            order_repository=order_repo,
            refund_repository=RefundRepository(session),
            user_repository=UserRepository(session),
        )
        response = service.create_request(
            user=user,
            payload=RefundCreateRequest(
                order_id="ord-r-payment-pending-1",
                reason_code=RefundReasonCode.LATE_DELIVERY,
                simulation_scenario_id="default",
            ),
            idempotency_key="idem-payment-pending-1",
        )

        session.refresh(user)
        assert response.status == RefundRequestStatus.DENIED
        assert RefundDecisionReasonCode.PAYMENT_NOT_CAPTURED in response.decision_reason_codes
        assert user.balance_cents == starting_balance
    finally:
        session.close()


def test_manual_review_resolved_with_zero_amount_does_not_change_balance() -> None:
    session = build_session()
    try:
        user = _create_user(session)
        starting_balance = user.balance_cents
        order_repo = OrderRepository(session)
        order_repo.create(order_id="ord-r-manual-1", user_id=user.id, total_cents=3000)

        service = RefundService(
            order_repository=order_repo,
            refund_repository=RefundRepository(session),
            user_repository=UserRepository(session),
        )
        created = service.create_request(
            user=user,
            payload=RefundCreateRequest(
                order_id="ord-r-manual-1",
                reason_code=RefundReasonCode.FRAUD,
                simulation_scenario_id="default",
            ),
            idempotency_key="idem-manual-credit-1",
        )
        assert created.status == RefundRequestStatus.PENDING_MANUAL_REVIEW

        claimed = service.claim_manual_review_request(refund_request_id=created.refund_request_id, admin_user_id=999)
        assert claimed.manual_review_handoff is not None
        assert claimed.manual_review_handoff.escalation_status == "in_review"

        resolved = service.decide_manual_review_request(
            refund_request_id=created.refund_request_id,
            decision="resolved",
            reviewer_note="approved by manager",
            admin_user_id=999,
        )
        session.refresh(user)

        assert resolved.status == RefundRequestStatus.RESOLVED
        assert resolved.refundable_amount_value == 0.0
        assert user.balance_cents == starting_balance
    finally:
        session.close()
