from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from app.core.errors import ConflictError
from app.core.errors import ForbiddenError
from app.core.errors import NotFoundError
from app.models.user import User
from app.repositories.support_repository import SupportRepository
from app.schemas.support import SupportConversationCreateRequest


class SupportChatService:
    def __init__(self, support_repository: SupportRepository) -> None:
        self.support_repository = support_repository

    def create_or_reuse_conversation(
        self,
        *,
        customer_user: User,
        payload: SupportConversationCreateRequest,
    ):
        if customer_user.is_guest:
            raise ForbiddenError("Guest users cannot open live support conversations")

        existing = self.support_repository.get_latest_conversation_for_customer(customer_user.id)
        if existing is not None:
            return existing

        conversation_id = f"sc_{uuid4().hex[:20]}"

        return self.support_repository.create_conversation(
            conversation_id=conversation_id,
            customer_user_id=customer_user.id,
            source_session_id=payload.source_session_id,
            priority=payload.priority,
        )

    def get_conversation(self, *, current_user: User, conversation_id: str):
        row = self.support_repository.get_conversation_by_id(conversation_id)
        if row is None:
            raise NotFoundError("Support conversation not found")

        if current_user.is_admin:
            return row
        if row.customer_user_id != current_user.id:
            raise ForbiddenError("Conversation does not belong to current user")
        return row

    def list_messages(
        self,
        *,
        current_user: User,
        conversation_id: str,
        limit: int = 50,
        before_message_id: str | None = None,
    ):
        _ = self.get_conversation(current_user=current_user, conversation_id=conversation_id)
        return self.support_repository.list_messages(
            conversation_id=conversation_id,
            limit=limit,
            before_message_id=before_message_id,
        )

    def send_message(self, *, current_user: User, conversation_id: str, body: str):
        row = self.get_conversation(current_user=current_user, conversation_id=conversation_id)
        if current_user.is_admin:
            if row.assigned_admin_user_id is None:
                claimed = self.support_repository.claim_conversation(
                    conversation_id=conversation_id,
                    admin_user_id=current_user.id,
                )
                if claimed is None:
                    raise ConflictError("Conversation cannot be claimed")
                row = claimed
            elif row.assigned_admin_user_id != current_user.id:
                raise ForbiddenError("Conversation is assigned to another admin")
            sender_role = "admin"
        else:
            if row.customer_user_id != current_user.id:
                raise ForbiddenError("Conversation does not belong to current user")
            sender_role = "customer"

        message_id = f"sm_{uuid4().hex[:24]}"

        return self.support_repository.create_message(
            message_id=message_id,
            conversation_id=conversation_id,
            sender_user_id=current_user.id,
            sender_role=sender_role,
            body=body.strip(),
        )

    def list_open_queue(self, *, admin_user: User, limit: int = 50):
        if not admin_user.is_admin:
            raise ForbiddenError("Admin access required")
        return self.support_repository.list_open_queue(limit=limit)

    def list_assigned(self, *, admin_user: User, limit: int = 50):
        if not admin_user.is_admin:
            raise ForbiddenError("Admin access required")
        return self.support_repository.list_assigned_to_admin(admin_user_id=admin_user.id, limit=limit)

    def list_admin_conversations(
        self,
        *,
        admin_user: User,
        limit: int = 100,
        status: str | None = None,
        priority: str | None = None,
        unread_only: bool = False,
        created_after: datetime | None = None,
        created_before: datetime | None = None,
        updated_after: datetime | None = None,
        updated_before: datetime | None = None,
    ):
        if not admin_user.is_admin:
            raise ForbiddenError("Admin access required")
        return self.support_repository.list_conversations(
            limit=limit,
            status=status,
            priority=priority,
            unread_only=unread_only,
            created_after=created_after,
            created_before=created_before,
            updated_after=updated_after,
            updated_before=updated_before,
        )

    def claim_conversation(self, *, admin_user: User, conversation_id: str):
        if not admin_user.is_admin:
            raise ForbiddenError("Admin access required")
        claimed = self.support_repository.claim_conversation(
            conversation_id=conversation_id,
            admin_user_id=admin_user.id,
        )
        if claimed is None:
            raise ConflictError("Conversation cannot be claimed in current state")
        return claimed

    def release_conversation(self, *, admin_user: User, conversation_id: str):
        if not admin_user.is_admin:
            raise ForbiddenError("Admin access required")
        released = self.support_repository.release_conversation(
            conversation_id=conversation_id,
            admin_user_id=admin_user.id,
        )
        if released is None:
            raise ConflictError("Conversation cannot be released in current state")
        return released

    def close_conversation(self, *, admin_user: User, conversation_id: str):
        if not admin_user.is_admin:
            raise ForbiddenError("Admin access required")
        row = self.support_repository.get_conversation_by_id(conversation_id)
        if row is None:
            raise NotFoundError("Support conversation not found")
        if row.assigned_admin_user_id not in {None, admin_user.id}:
            raise ForbiddenError("Conversation is assigned to another admin")

        closed = self.support_repository.close_conversation(conversation_id=conversation_id)
        if closed is None:
            raise ConflictError("Conversation cannot be closed in current state")
        return closed

    def update_conversation_priority(self, *, admin_user: User, conversation_id: str, priority: str):
        if not admin_user.is_admin:
            raise ForbiddenError("Admin access required")

        row = self.support_repository.update_conversation_priority(
            conversation_id=conversation_id,
            priority=priority,
        )
        if row is None:
            raise NotFoundError("Support conversation not found")
        return row

    def mark_conversation_messages_read(self, *, admin_user: User, conversation_id: str) -> int:
        if not admin_user.is_admin:
            raise ForbiddenError("Admin access required")
        return self.support_repository.mark_conversation_messages_read(conversation_id=conversation_id)
