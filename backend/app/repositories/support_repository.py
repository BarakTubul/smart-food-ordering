from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models.support_conversation import SupportConversation
from app.models.support_message import SupportMessage


class SupportRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_conversation_by_id(self, conversation_id: str) -> SupportConversation | None:
        stmt = select(SupportConversation).where(SupportConversation.conversation_id == conversation_id)
        return self.db.scalar(stmt)

    def get_active_conversation_for_customer(self, customer_user_id: int) -> SupportConversation | None:
        stmt = (
            select(SupportConversation)
            .where(SupportConversation.customer_user_id == customer_user_id)
            .where(SupportConversation.status.in_(["open", "assigned"]))
            .order_by(SupportConversation.created_at.desc())
            .limit(1)
        )
        return self.db.scalar(stmt)

    def get_latest_conversation_for_customer(self, customer_user_id: int) -> SupportConversation | None:
        stmt = (
            select(SupportConversation)
            .where(SupportConversation.customer_user_id == customer_user_id)
            .order_by(SupportConversation.created_at.desc())
            .limit(1)
        )
        return self.db.scalar(stmt)

    def create_conversation(
        self,
        *,
        conversation_id: str,
        customer_user_id: int,
        source_session_id: str | None,
        priority: str,
    ) -> SupportConversation:
        row = SupportConversation(
            conversation_id=conversation_id,
            customer_user_id=customer_user_id,
            source_session_id=source_session_id,
            status="open",
            priority=priority,
            assigned_admin_user_id=None,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def list_open_queue(self, *, limit: int = 50) -> list[SupportConversation]:
        bounded = max(1, min(limit, 500))
        stmt = (
            select(SupportConversation)
            .where(SupportConversation.status == "open")
            .where(SupportConversation.assigned_admin_user_id.is_(None))
            .order_by(SupportConversation.created_at.asc())
            .limit(bounded)
        )
        return list(self.db.scalars(stmt).all())

    def list_assigned_to_admin(self, *, admin_user_id: int, limit: int = 50) -> list[SupportConversation]:
        bounded = max(1, min(limit, 500))
        stmt = (
            select(SupportConversation)
            .where(SupportConversation.assigned_admin_user_id == admin_user_id)
            .where(SupportConversation.status.in_(["assigned", "open"]))
            .order_by(SupportConversation.updated_at.desc())
            .limit(bounded)
        )
        return list(self.db.scalars(stmt).all())

    def list_conversations(
        self,
        *,
        limit: int = 100,
        status: str | None = None,
        priority: str | None = None,
        unread_only: bool = False,
        created_after: datetime | None = None,
        created_before: datetime | None = None,
        updated_after: datetime | None = None,
        updated_before: datetime | None = None,
    ):
        bounded = max(1, min(limit, 500))

        last_admin_at = (
            select(func.max(SupportMessage.created_at))
            .where(SupportMessage.conversation_id == SupportConversation.conversation_id)
            .where(SupportMessage.sender_role == "admin")
            .correlate(SupportConversation)
            .scalar_subquery()
        )

        unread_message_count = (
            select(func.count(SupportMessage.id))
            .where(SupportMessage.conversation_id == SupportConversation.conversation_id)
            .where(SupportMessage.sender_role == "customer")
            .where(SupportMessage.read_at.is_(None))
            .where(or_(last_admin_at.is_(None), SupportMessage.created_at > last_admin_at))
            .correlate(SupportConversation)
            .scalar_subquery()
        )

        last_message_at = (
            select(func.max(SupportMessage.created_at))
            .where(SupportMessage.conversation_id == SupportConversation.conversation_id)
            .correlate(SupportConversation)
            .scalar_subquery()
        )

        last_message_preview = (
            select(SupportMessage.body)
            .where(SupportMessage.conversation_id == SupportConversation.conversation_id)
            .order_by(SupportMessage.created_at.desc(), SupportMessage.id.desc())
            .limit(1)
            .correlate(SupportConversation)
            .scalar_subquery()
        )

        stmt = select(
            SupportConversation,
            last_message_at.label("last_message_at"),
            last_message_preview.label("last_message_preview"),
            unread_message_count.label("unread_message_count"),
        )

        if status:
            stmt = stmt.where(SupportConversation.status == status)
        if priority:
            stmt = stmt.where(SupportConversation.priority == priority)
        if unread_only:
            stmt = stmt.where(unread_message_count > 0)
        if created_after is not None:
            stmt = stmt.where(SupportConversation.created_at >= created_after)
        if created_before is not None:
            stmt = stmt.where(SupportConversation.created_at <= created_before)
        if updated_after is not None:
            stmt = stmt.where(SupportConversation.updated_at >= updated_after)
        if updated_before is not None:
            stmt = stmt.where(SupportConversation.updated_at <= updated_before)

        stmt = stmt.order_by(SupportConversation.updated_at.desc(), SupportConversation.created_at.desc()).limit(bounded)
        return list(self.db.execute(stmt).all())

    def claim_conversation(self, *, conversation_id: str, admin_user_id: int) -> SupportConversation | None:
        row = self.get_conversation_by_id(conversation_id)
        if row is None or row.status == "closed":
            return None
        if row.assigned_admin_user_id is not None and row.assigned_admin_user_id != admin_user_id:
            return None

        row.assigned_admin_user_id = admin_user_id
        row.status = "assigned"
        row.updated_at = datetime.now(UTC)

        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def release_conversation(self, *, conversation_id: str, admin_user_id: int) -> SupportConversation | None:
        row = self.get_conversation_by_id(conversation_id)
        if row is None or row.status == "closed":
            return None
        if row.assigned_admin_user_id != admin_user_id:
            return None

        row.assigned_admin_user_id = None
        row.status = "open"
        row.updated_at = datetime.now(UTC)

        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def close_conversation(self, *, conversation_id: str) -> SupportConversation | None:
        row = self.get_conversation_by_id(conversation_id)
        if row is None or row.status == "closed":
            return None

        now = datetime.now(UTC)
        row.status = "closed"
        row.updated_at = now

        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def update_conversation_priority(self, *, conversation_id: str, priority: str) -> SupportConversation | None:
        row = self.get_conversation_by_id(conversation_id)
        if row is None:
            return None

        row.priority = priority
        row.updated_at = datetime.now(UTC)

        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def mark_conversation_messages_read(self, *, conversation_id: str) -> int:
        stmt = (
            select(SupportMessage)
            .where(SupportMessage.conversation_id == conversation_id)
            .where(SupportMessage.sender_role == "customer")
            .where(SupportMessage.read_at.is_(None))
        )
        rows = list(self.db.scalars(stmt).all())
        now = datetime.now(UTC)
        for row in rows:
            row.read_at = now
            self.db.add(row)
        if rows:
            self.db.commit()
        return len(rows)

    def create_message(
        self,
        *,
        message_id: str,
        conversation_id: str,
        sender_user_id: int,
        sender_role: str,
        body: str,
    ) -> SupportMessage:
        conversation = self.get_conversation_by_id(conversation_id)
        if conversation is not None:
            now = datetime.now(UTC)
            if sender_role == "customer" and conversation.status == "closed":
                conversation.status = "open"
                conversation.assigned_admin_user_id = None
            conversation.updated_at = now
            self.db.add(conversation)

        row = SupportMessage(
            message_id=message_id,
            conversation_id=conversation_id,
            sender_user_id=sender_user_id,
            sender_role=sender_role,
            body=body,
            delivered_at=datetime.now(UTC),
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def list_messages(
        self,
        *,
        conversation_id: str,
        limit: int = 50,
        before_message_id: str | None = None,
    ) -> list[SupportMessage]:
        bounded = max(1, min(limit, 500))

        stmt = select(SupportMessage).where(SupportMessage.conversation_id == conversation_id)

        if before_message_id is not None:
            anchor_stmt = (
                select(SupportMessage)
                .where(SupportMessage.conversation_id == conversation_id)
                .where(SupportMessage.message_id == before_message_id)
                .limit(1)
            )
            anchor = self.db.scalar(anchor_stmt)
            if anchor is None:
                return []

            stmt = stmt.where(
                or_(
                    SupportMessage.created_at < anchor.created_at,
                    and_(
                        SupportMessage.created_at == anchor.created_at,
                        SupportMessage.id < anchor.id,
                    ),
                )
            )

        stmt = stmt.order_by(SupportMessage.created_at.desc(), SupportMessage.id.desc()).limit(bounded)
        rows = list(self.db.scalars(stmt).all())
        rows.reverse()
        return rows
