from __future__ import annotations

from datetime import date
from datetime import datetime

from pydantic import BaseModel


class SessionStateResponse(BaseModel):
    authenticated: bool
    user_id: int
    is_guest: bool
    is_admin: bool
    is_active: bool


class AccountMeResponse(BaseModel):
    user_id: int
    email_masked: str | None
    full_name: str | None = None
    date_of_birth: date | None = None
    address: str | None = None
    account_status: str
    is_admin: bool
    demo_card_last4: str | None = None
    balance_cents: int = 0


class DemoCardRevealRequest(BaseModel):
    password: str


class DemoCardRevealResponse(BaseModel):
    demo_card_number: str


class OrderTimelineEvent(BaseModel):
    event: str
    timestamp: datetime
    source: str


class OrderResponse(BaseModel):
    order_id: str
    status: str
    status_label: str
    payment_state: str
    ordered_items_summary: str | None = None
    total_cents: int = 0
    created_at: datetime
    updated_at: datetime
    eta_from: datetime | None
    eta_to: datetime | None


class OrderListResponse(BaseModel):
    items: list[OrderResponse]
    total: int
    limit: int
    offset: int


class OrderTimelineResponse(BaseModel):
    order_id: str
    scenario_id: str
    is_delayed: bool = False
    issue_code: str | None = None
    ordered_items_summary: str | None = None
    received_items_summary: str | None = None
    eta_from: datetime | None = None
    eta_to: datetime | None = None
    events: list[OrderTimelineEvent]
