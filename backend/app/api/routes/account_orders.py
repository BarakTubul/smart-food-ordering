from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_account_order_service, get_current_user, get_current_user_from_cookie
from app.models.user import User
from app.schemas.account import (
    AccountMeResponse,
    DemoCardRevealRequest,
    DemoCardRevealResponse,
    OrderListResponse,
    OrderResponse,
    OrderTimelineResponse,
    SessionStateResponse,
)
from app.services.account_order_service import AccountOrderService

router = APIRouter()


@router.get("/auth/session", response_model=SessionStateResponse)
def get_auth_session(
    current_user: User = Depends(get_current_user),
    account_order_service: AccountOrderService = Depends(get_account_order_service),
) -> SessionStateResponse:
    return account_order_service.get_session_state(current_user)


@router.get("/account/me", response_model=AccountMeResponse)
def get_account_me(
    current_user: User = Depends(get_current_user),
    account_order_service: AccountOrderService = Depends(get_account_order_service),
) -> AccountMeResponse:
    return account_order_service.get_account_me(current_user)


@router.post("/account/demo-card/reveal", response_model=DemoCardRevealResponse)
def reveal_demo_card(
    payload: DemoCardRevealRequest,
    current_user: User = Depends(get_current_user),
    account_order_service: AccountOrderService = Depends(get_account_order_service),
) -> DemoCardRevealResponse:
    return account_order_service.reveal_demo_card(user=current_user, password=payload.password)


@router.get("/orders", response_model=OrderListResponse)
def list_orders(
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    account_order_service: AccountOrderService = Depends(get_account_order_service),
) -> OrderListResponse:
    return account_order_service.list_orders(current_user, limit=limit, offset=offset)


@router.get("/orders/{order_id}", response_model=OrderResponse)
def get_order(
    order_id: str,
    current_user: User = Depends(get_current_user),
    account_order_service: AccountOrderService = Depends(get_account_order_service),
) -> OrderResponse:
    return account_order_service.get_order(user=current_user, order_id=order_id)


@router.get("/orders/{order_id}/timeline-sim", response_model=OrderTimelineResponse)
def get_order_timeline_sim(
    order_id: str,
    scenario_id: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    account_order_service: AccountOrderService = Depends(get_account_order_service),
) -> OrderTimelineResponse:
    return account_order_service.get_order_timeline_sim(
        user=current_user,
        order_id=order_id,
        scenario_id=scenario_id,
    )
