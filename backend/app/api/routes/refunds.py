from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Header, Query, Response, status

from app.api.dependencies import get_current_user, get_refund_service, require_admin_user
from app.models.user import User
from app.schemas.refund import (
    ManualReviewDecisionRequest,
    ManualReviewQueueResponse,
    OrderStateSimResponse,
    RefundCreateRequest,
    RefundEligibilityCheckRequest,
    RefundEligibilityCheckResponse,
    RefundRequestListResponse,
    RefundRequestResponse,
)
from app.services.refund_service import RefundService

router = APIRouter()


@router.post("/refunds/eligibility/check", response_model=RefundEligibilityCheckResponse)
def check_refund_eligibility(
    payload: RefundEligibilityCheckRequest,
    current_user: User = Depends(get_current_user),
    refund_service: RefundService = Depends(get_refund_service),
) -> RefundEligibilityCheckResponse:
    return refund_service.check_eligibility(user=current_user, payload=payload)


@router.post("/refunds/requests", response_model=RefundRequestResponse, status_code=status.HTTP_201_CREATED)
def create_refund_request(
    payload: RefundCreateRequest,
    response: Response,
    current_user: User = Depends(get_current_user),
    refund_service: RefundService = Depends(get_refund_service),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> RefundRequestResponse:
    result = refund_service.create_request(
        user=current_user,
        payload=payload,
        idempotency_key=idempotency_key,
    )
    if result.idempotent_replay:
        response.status_code = status.HTTP_200_OK
    return result


@router.get("/refunds/requests", response_model=RefundRequestListResponse)
def list_refund_requests(
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    refund_service: RefundService = Depends(get_refund_service),
) -> RefundRequestListResponse:
    return refund_service.list_user_refund_requests(
        user=current_user,
        limit=limit,
        offset=offset,
        status=status,
        query=q,
    )


@router.get("/refunds/requests/{refund_request_id}", response_model=RefundRequestResponse)
def get_refund_request(
    refund_request_id: str,
    current_user: User = Depends(get_current_user),
    refund_service: RefundService = Depends(get_refund_service),
) -> RefundRequestResponse:
    return refund_service.get_request(user=current_user, refund_request_id=refund_request_id)


@router.get("/orders/{order_id}/state-sim", response_model=OrderStateSimResponse)
def get_order_state_sim(
    order_id: str,
    scenario_id: str = Query(default="default"),
    current_user: User = Depends(get_current_user),
    refund_service: RefundService = Depends(get_refund_service),
) -> OrderStateSimResponse:
    return refund_service.get_order_state_sim(user=current_user, order_id=order_id, scenario_id=scenario_id)


@router.get("/admin/refunds/manual-review/queue", response_model=ManualReviewQueueResponse)
def list_manual_review_queue(
    limit: int = Query(default=50, ge=1, le=500),
    before_sla: datetime | None = Query(default=None),
    admin_user: User = Depends(require_admin_user),
    refund_service: RefundService = Depends(get_refund_service),
) -> ManualReviewQueueResponse:
    _ = admin_user
    return refund_service.list_manual_review_queue(limit=limit, before_sla=before_sla)


@router.post("/admin/refunds/requests/{refund_request_id}/claim", response_model=RefundRequestResponse)
def claim_manual_review_request(
    refund_request_id: str,
    admin_user: User = Depends(require_admin_user),
    refund_service: RefundService = Depends(get_refund_service),
) -> RefundRequestResponse:
    return refund_service.claim_manual_review_request(
        refund_request_id=refund_request_id,
        admin_user_id=admin_user.id,
    )


@router.post("/admin/refunds/requests/{refund_request_id}/decision", response_model=RefundRequestResponse)
def decide_manual_review_request(
    refund_request_id: str,
    payload: ManualReviewDecisionRequest,
    admin_user: User = Depends(require_admin_user),
    refund_service: RefundService = Depends(get_refund_service),
) -> RefundRequestResponse:
    return refund_service.decide_manual_review_request(
        refund_request_id=refund_request_id,
        decision=payload.decision,
        reviewer_note=payload.reviewer_note,
        admin_user_id=admin_user.id,
    )
