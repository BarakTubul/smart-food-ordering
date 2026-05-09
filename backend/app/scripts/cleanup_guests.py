from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select

from app.db.session import SessionLocal
from app.models.conversation_message import ConversationMessage
from app.models.order import Order
from app.models.refund_request import RefundRequest
from app.models.support_conversation import SupportConversation
from app.models.support_message import SupportMessage
from app.models.user import User


@dataclass
class CleanupReport:
    scanned: int = 0
    eligible: int = 0
    skipped_with_dependencies: int = 0
    deleted_users: int = 0
    deleted_conversation_messages: int = 0
    deleted_support_messages: int = 0


def _count(db, stmt) -> int:
    return int(db.scalar(stmt) or 0)


def _dependency_counts(db, *, user_id: int) -> dict[str, int]:
    return {
        "orders": _count(db, select(func.count()).select_from(Order).where(Order.user_id == user_id)),
        "refund_requests": _count(
            db, select(func.count()).select_from(RefundRequest).where(RefundRequest.user_id == user_id)
        ),
        "support_conversations": _count(
            db,
            select(func.count())
            .select_from(SupportConversation)
            .where(
                (SupportConversation.customer_user_id == user_id)
                | (SupportConversation.assigned_admin_user_id == user_id)
            ),
        ),
        "support_messages": _count(
            db,
            select(func.count()).select_from(SupportMessage).where(SupportMessage.sender_user_id == user_id),
        ),
        "conversation_messages": _count(
            db,
            select(func.count()).select_from(ConversationMessage).where(ConversationMessage.user_id == user_id),
        ),
    }


def cleanup_guests(*, days: int, dry_run: bool, limit: int | None) -> CleanupReport:
    bounded_days = max(1, int(days))
    cutoff = datetime.now(UTC) - timedelta(days=bounded_days)

    report = CleanupReport()

    with SessionLocal() as db:
        stmt = (
            select(User)
            .where(User.is_guest.is_(True))
            .where(User.created_at < cutoff)
            .order_by(User.created_at.asc())
        )
        if limit is not None:
            stmt = stmt.limit(max(1, int(limit)))

        candidates = list(db.scalars(stmt).all())

        for user in candidates:
            report.scanned += 1
            counts = _dependency_counts(db, user_id=user.id)

            hard_deps = counts["orders"] + counts["refund_requests"] + counts["support_conversations"] + counts["support_messages"]
            if hard_deps > 0:
                report.skipped_with_dependencies += 1
                continue

            report.eligible += 1

            if dry_run:
                continue

            deleted_support = db.execute(
                delete(SupportMessage).where(SupportMessage.sender_user_id == user.id)
            ).rowcount
            if deleted_support:
                report.deleted_support_messages += int(deleted_support)

            deleted_conv = db.execute(
                delete(ConversationMessage).where(ConversationMessage.user_id == user.id)
            ).rowcount
            if deleted_conv:
                report.deleted_conversation_messages += int(deleted_conv)

            db.delete(user)
            report.deleted_users += 1
            db.commit()

    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Delete stale guest users (safe cleanup).")
    parser.add_argument("--days", type=int, default=30, help="Delete guests older than this many days (default: 30).")
    parser.add_argument(
        "--dry-run",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="When true, only prints what would be deleted (default: true).",
    )
    parser.add_argument("--limit", type=int, default=None, help="Optional limit on number of guests to scan.")

    args = parser.parse_args(argv)

    report = cleanup_guests(days=args.days, dry_run=args.dry_run, limit=args.limit)

    mode = "DRY RUN" if args.dry_run else "EXECUTE"
    print(f"[{mode}] cutoff_days={args.days}")
    print(
        "summary="
        f"scanned={report.scanned} eligible={report.eligible} skipped_with_dependencies={report.skipped_with_dependencies} "
        f"deleted_users={report.deleted_users} deleted_conversation_messages={report.deleted_conversation_messages} "
        f"deleted_support_messages={report.deleted_support_messages}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
