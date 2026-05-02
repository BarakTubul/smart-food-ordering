from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class RefundReasonCode(str, Enum):
    MISSING_ITEM = "missing_item"
    WRONG_ITEM = "wrong_item"
    LATE_DELIVERY = "late_delivery"
    QUALITY_ISSUE = "quality_issue"
    FRAUD = "fraud"
    ABUSE = "abuse"
    OTHER = "other"


class RefundDecisionReasonCode(str, Enum):
    ELIGIBLE = "eligible"
    ELIGIBLE_PARTIAL = "eligible_partial"
    PAYMENT_NOT_CAPTURED = "payment_not_captured"
    REFUND_WINDOW_EXPIRED = "refund_window_expired"
    NON_REFUNDABLE_ITEM = "non_refundable_item"
    MANUAL_REVIEW_REQUIRED = "manual_review_required"
    FULFILLMENT_NOT_COMPLETED = "fulfillment_not_completed"
    REASON_CODE_NOT_SUPPORTED = "reason_code_not_supported"


class RefundPolicyVersion(str, Enum):
    V1 = "v1"


class RefundResolutionAction(str, Enum):
    APPROVE_FULL = "approve_full"
    APPROVE_PARTIAL = "approve_partial"
    DENY = "deny"
    MANUAL_REVIEW = "manual_review"


class RefundRequestStatus(str, Enum):
    SUBMITTED = "submitted"
    DENIED = "denied"
    PENDING_MANUAL_REVIEW = "pending_manual_review"
    RESOLVED = "resolved"


class ManualReviewEscalationStatus(str, Enum):
    QUEUED = "queued"
    IN_REVIEW = "in_review"
    RESOLVED = "resolved"
    REJECTED = "rejected"


class ManualReviewDecision(str, Enum):
    RESOLVED = "resolved"
    REJECTED = "rejected"


class ItemSelection(BaseModel):
    item_id: str
    quantity: int = Field(ge=1)


class RefundEligibilityCheckRequest(BaseModel):
    order_id: str
    reason_code: RefundReasonCode
    item_selections: list[ItemSelection] = []
    simulation_scenario_id: str = "default"


class MoneyAmount(BaseModel):
    currency: str
    value: float


class RefundEligibilityCheckResponse(BaseModel):
    eligible: bool
    resolution_action: RefundResolutionAction
    decision_reason_codes: list[RefundDecisionReasonCode]
    explanation_template_key: str
    explanation_params: dict[str, str | int | float | bool]
    policy_version: RefundPolicyVersion
    policy_reference: str
    refundable_amount: MoneyAmount
    simulated_state: str


class RefundCreateRequest(BaseModel):
    order_id: str
    reason_code: RefundReasonCode
    item_selections: list[ItemSelection] = []
    simulation_scenario_id: str = "default"

class ManualReviewHandoff(BaseModel):
    escalation_status: ManualReviewEscalationStatus
    queue_name: str
    sla_deadline_at: datetime
    payload: dict[str, str | int | float | bool]
    claimed_by_admin_user_id: int | None = None
    claimed_at: datetime | None = None
    decided_by_admin_user_id: int | None = None
    decided_at: datetime | None = None
    reviewer_note: str | None = None


class ManualReviewQueueItem(BaseModel):
    refund_request_id: str
    order_id: str
    status: RefundRequestStatus
    created_at: datetime
    handoff: ManualReviewHandoff


class ManualReviewQueueResponse(BaseModel):
    items: list[ManualReviewQueueItem]
    total: int


class ManualReviewDecisionRequest(BaseModel):
    decision: ManualReviewDecision
    reviewer_note: str | None = None


class RefundRequestResponse(BaseModel):
    refund_request_id: str
    order_id: str
    reason_code: RefundReasonCode
    status: RefundRequestStatus
    status_reason: str | None
    manual_review_handoff: ManualReviewHandoff | None = None
    decision_reason_codes: list[RefundDecisionReasonCode] = []
    policy_version: RefundPolicyVersion | None = None
    policy_reference: str | None = None
    resolution_action: RefundResolutionAction | None = None
    refundable_amount_currency: str | None = None
    refundable_amount_value: float | None = None
    explanation_template_key: str | None = None
    explanation_params: dict[str, str | int | float | bool] | None = None
    created_at: datetime
    idempotent_replay: bool = False


class RefundRequestListResponse(BaseModel):
    items: list[RefundRequestResponse]
    total: int
    limit: int
    offset: int


class OrderStateSimResponse(BaseModel):
    order_id: str
    simulation_scenario_id: str
    fulfillment_state: str
    payment_state: str
    state_timeline: list[dict[str, str]]
