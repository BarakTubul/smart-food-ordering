from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

from app.core.errors import ForbiddenError, NotFoundError, UnauthorizedError
from app.core.security import verify_password
from app.models.user import User
from app.repositories.order_repository import OrderRepository
from app.repositories.user_repository import UserRepository
from app.schemas.account import (
    AccountMeResponse,
    DemoCardRevealResponse,
    OrderListResponse,
    OrderResponse,
    OrderTimelineEvent,
    OrderTimelineResponse,
    SessionStateResponse,
)


class AccountOrderService:
    _SIMULATION_SCENARIOS: tuple[str, ...] = (
        "on_time",
        "late_delivery",
        "missing_item",
        "wrong_item",
        "quality_issue",
    )

    def __init__(self, order_repository: OrderRepository, user_repository: UserRepository) -> None:
        self.order_repository = order_repository
        self.user_repository = user_repository

    def get_session_state(self, user: User) -> SessionStateResponse:
        return SessionStateResponse(
            authenticated=True,
            user_id=user.id,
            is_guest=user.is_guest,
            is_admin=user.is_admin,
            is_active=user.is_active,
        )

    def get_account_me(self, user: User) -> AccountMeResponse:
        if user.is_guest:
            raise ForbiddenError("Guest users cannot access account profile")

        user = self.user_repository.ensure_demo_card(user)

        status = "verified_active" if user.is_verified and user.is_active else "restricted"
        return AccountMeResponse(
            user_id=user.id,
            email_masked=self._mask_email(user.email),
            full_name=user.full_name,
            date_of_birth=user.date_of_birth,
            address=user.address,
            account_status=status,
            is_admin=user.is_admin,
            demo_card_last4=self._card_last4(user.demo_card_number),
            balance_cents=user.balance_cents or 0,
        )

    def reveal_demo_card(self, *, user: User, password: str) -> DemoCardRevealResponse:
        if user.is_guest:
            raise ForbiddenError("Guest users cannot access demo card")
        if not user.password_hash:
            raise ForbiddenError("Password is not configured for this account")
        if not verify_password(password, user.password_hash):
            raise UnauthorizedError("Invalid password")

        user = self.user_repository.ensure_demo_card(user)
        if not user.demo_card_number:
            raise NotFoundError("Demo card not found")
        return DemoCardRevealResponse(demo_card_number=user.demo_card_number)

    def list_orders(self, user: User, *, limit: int, offset: int) -> OrderListResponse:
        if user.is_guest:
            return OrderListResponse(items=[], total=0, limit=limit, offset=offset)

        orders = self.order_repository.list_by_user(user.id, limit=limit, offset=offset)
        total = self.order_repository.count_by_user(user.id)
        items = [
            self._build_order_response(order)
            for order in orders
        ]
        return OrderListResponse(items=items, total=total, limit=limit, offset=offset)

    def get_order(self, *, user: User, order_id: str) -> OrderResponse:
        if user.is_guest:
            raise ForbiddenError("Guest users cannot access orders")

        order = self.order_repository.get_by_order_id(order_id)
        if order is None:
            raise NotFoundError("Order not found")
        if order.user_id != user.id:
            raise ForbiddenError("Order does not belong to current user")

        return self._build_order_response(order)

    def _build_order_response(self, order) -> OrderResponse:
        eta_from, eta_to = self._resolve_eta_window(order)
        return OrderResponse(
            order_id=order.order_id,
            status=order.status,
            status_label=order.status_label,
            payment_state=order.payment_state,
            ordered_items_summary=order.ordered_items_summary,
            total_cents=order.total_cents or 0,
            created_at=order.created_at,
            updated_at=order.updated_at,
            eta_from=eta_from,
            eta_to=eta_to,
        )

    @staticmethod
    def _resolve_eta_window(order) -> tuple[datetime | None, datetime | None]:
        if order.eta_from and order.eta_to:
            return order.eta_from, order.eta_to

        now = datetime.now(UTC)
        eta_from = order.created_at.astimezone(UTC) + timedelta(minutes=1)
        eta_to = order.created_at.astimezone(UTC) + timedelta(minutes=2)

        if now > eta_to:
            eta_from = now + timedelta(minutes=1)
            eta_to = now + timedelta(minutes=2)

        return eta_from, eta_to

    def get_order_timeline_sim(
        self,
        *,
        user: User,
        order_id: str,
        scenario_id: str | None,
    ) -> OrderTimelineResponse:
        order = self.get_order(user=user, order_id=order_id)
        selected_scenario = scenario_id or self._pick_default_scenario(order_id)
        seed = hashlib.sha256(f"{order_id}:{selected_scenario}".encode("utf-8")).hexdigest()
        offset = int(seed[:2], 16) % 5
        base_time = order.created_at.astimezone(UTC)
        now = datetime.now(UTC)
        stage_definitions = self._build_timeline_stage_definitions(selected_scenario, offset)
        elapsed_seconds = (now - base_time).total_seconds()
        delivered_seconds = stage_definitions[-1][1]
        simulated_eta_center = base_time + timedelta(seconds=delivered_seconds)
        simulated_eta_from = simulated_eta_center - timedelta(seconds=10)
        simulated_eta_to = simulated_eta_center + timedelta(seconds=10)

        events = [
            OrderTimelineEvent(event=event_name, timestamp=base_time + timedelta(seconds=seconds_after), source="sim")
            for event_name, seconds_after in stage_definitions
            if seconds_after <= elapsed_seconds
        ]

        if not events:
            events = [OrderTimelineEvent(event="accepted", timestamp=base_time + timedelta(seconds=60 + offset), source="sim")]

        ordered_summary = order.ordered_items_summary
        received_summary = ordered_summary
        issue_code: str | None = None
        is_delayed = False
        
        # Only reveal delivery outcome after order has been delivered
        delivered_time = delivered_seconds  # Last event is always "delivered"
        is_order_delivered = elapsed_seconds >= delivered_time

        if is_order_delivered:
            is_delayed = selected_scenario == "late_delivery"
            
            if selected_scenario == "missing_item":
                issue_code = "missing_item"
                received_summary = f"{ordered_summary or 'Order items'} (one item missing)"
            elif selected_scenario == "wrong_item":
                issue_code = "wrong_item"
                received_summary = f"{ordered_summary or 'Order items'} (included wrong item)"
            elif selected_scenario == "quality_issue":
                issue_code = "quality_issue"
                received_summary = f"{ordered_summary or 'Order items'} (quality issue reported)"
            elif selected_scenario == "late_delivery":
                issue_code = "late_delivery"

        return OrderTimelineResponse(
            order_id=order.order_id,
            scenario_id=selected_scenario,
            is_delayed=is_delayed,
            issue_code=issue_code,
            ordered_items_summary=ordered_summary,
            received_items_summary=received_summary,
            eta_from=simulated_eta_from,
            eta_to=simulated_eta_to,
            events=events,
        )

    @classmethod
    def _pick_default_scenario(cls, order_id: str) -> str:
        seed = hashlib.sha256(order_id.encode("utf-8")).hexdigest()
        idx = int(seed[:2], 16) % len(cls._SIMULATION_SCENARIOS)
        return cls._SIMULATION_SCENARIOS[idx]

    @staticmethod
    def _build_timeline_stage_definitions(scenario_id: str, offset: int) -> list[tuple[str, int]]:
        if scenario_id == "late_delivery":
            return [
                ("accepted", 30 + offset),
                ("preparing", 60 + offset),
                ("pickup", 90 + offset),
                ("in_transit", 120 + offset),
                ("arriving", 150 + offset),
                ("delivered", 180 + offset),
            ]

        return [
            ("accepted", 10 + offset),
            ("preparing", 20 + offset),
            ("pickup", 30 + offset),
            ("in_transit", 40 + offset),
            ("arriving", 50 + offset),
            ("delivered", 60 + offset),
        ]

    @staticmethod
    def _mask_email(email: str | None) -> str | None:
        if email is None:
            return None
        name, _, domain = email.partition("@")
        if not domain:
            return "***"
        if len(name) <= 2:
            masked_name = "*" * len(name)
        else:
            masked_name = f"{name[0]}***{name[-1]}"
        return f"{masked_name}@{domain}"

    @staticmethod
    def _card_last4(card_number: str | None) -> str | None:
        if not card_number:
            return None
        digits = "".join(ch for ch in card_number if ch.isdigit())
        if len(digits) < 4:
            return None
        return digits[-4:]
