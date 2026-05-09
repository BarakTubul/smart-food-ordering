from __future__ import annotations

from datetime import UTC

from app.models.user import User
from app.schemas.notification import NotificationResponse
from app.services.account_order_service import AccountOrderService
from app.repositories.refund_repository import RefundRepository
from app.repositories.support_repository import SupportRepository


_LAST_NOTIFIED_STATUSES: dict[int, dict[str, str]] = {}
_LAST_NOTIFIED_ADMIN_REFUNDS: dict[int, set[str]] = {}
_LAST_NOTIFIED_ADMIN_SUPPORT: dict[int, dict[str, str]] = {}


class NotificationService:
    def __init__(
        self,
        *,
        account_order_service: AccountOrderService,
        refund_repository: RefundRepository,
        support_repository: SupportRepository,
    ) -> None:
        self.account_order_service = account_order_service
        self.refund_repository = refund_repository
        self.support_repository = support_repository

    def get_live_notifications(self, user: User) -> list[NotificationResponse]:
        if user.is_guest:
            return []

        notifications: list[NotificationResponse] = []

        orders_page = self.account_order_service.list_orders(user, limit=100, offset=0)
        if orders_page.items:
            seen_statuses = _LAST_NOTIFIED_STATUSES.setdefault(user.id, {})
            notifications.extend(
                self._build_order_notifications(
                    user=user,
                    orders=orders_page.items,
                    seen_statuses=seen_statuses,
                )
            )

        if user.is_admin:
            notifications.extend(self._build_admin_refund_notifications(user))
            notifications.extend(self._build_admin_support_notifications(user))

        notifications.sort(key=lambda item: item.created_at, reverse=True)
        return notifications

    def _build_order_notifications(
        self,
        *,
        user: User,
        orders,
        seen_statuses: dict[str, str],
    ) -> list[NotificationResponse]:
        notifications: list[NotificationResponse] = []

        for order in orders:
            timeline = self.account_order_service.get_order_timeline_sim(
                user=user,
                order_id=order.order_id,
                scenario_id="default",
            )
            latest_event = timeline.events[-1] if timeline.events else None
            current_status = latest_event.event if latest_event else order.status
            if seen_statuses.get(order.order_id) == current_status:
                continue

            seen_statuses[order.order_id] = current_status
            event_time = latest_event.timestamp if latest_event else order.updated_at.astimezone(UTC)
            notifications.append(
                NotificationResponse(
                    notification_id=f"{order.order_id}:{current_status}",
                    kind="order",
                    order_id=order.order_id,
                    target_path=f"/orders/{order.order_id}/timeline",
                    status=current_status,
                    title=self._build_title(current_status),
                    message=self._build_message(order.order_id, current_status),
                    created_at=event_time,
                )
            )

        return notifications

    def _build_admin_refund_notifications(self, user: User) -> list[NotificationResponse]:
        _ = user
        return []

    def _build_admin_support_notifications(self, user: User) -> list[NotificationResponse]:
        seen_conversations = _LAST_NOTIFIED_ADMIN_SUPPORT.setdefault(user.id, {})
        notifications: list[NotificationResponse] = []

        conversations = self.support_repository.list_conversations(limit=50, unread_only=True)
        for row, last_message_at, last_message_preview, unread_message_count in conversations:
            if unread_message_count <= 0 or last_message_at is None:
                continue

            last_seen = seen_conversations.get(row.conversation_id)
            last_message_stamp = last_message_at.isoformat()
            if last_seen == last_message_stamp:
                continue

            seen_conversations[row.conversation_id] = last_message_stamp
            notifications.append(
                NotificationResponse(
                    notification_id=f"support:{row.conversation_id}:{last_message_stamp}",
                    kind="support",
                    order_id=None,
                    target_path="/manager/support",
                    status=row.status,
                    title="New support message",
                    message=last_message_preview
                    or f"Conversation {row.conversation_id} has {int(unread_message_count)} unread message(s).",
                    created_at=last_message_at,
                )
            )

        return notifications

    @staticmethod
    def _build_title(status: str) -> str:
        if status == "delivered":
            return "Order delivered"
        if status == "arriving":
            return "Order arriving soon"
        return "Order updated"

    @staticmethod
    def _build_message(order_id: str, status: str) -> str:
        readable_status = status.replace("_", " ")
        if status == "delivered":
            return f"{order_id} has been delivered."
        if status == "arriving":
            return f"{order_id} is arriving now."
        return f"{order_id} is now {readable_status}."