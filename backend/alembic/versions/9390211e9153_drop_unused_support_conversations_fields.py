"""Drop unused support_conversations fields

Revision ID: 9390211e9153
Revises: 45e411cf3a07
Create Date: 2026-05-08 22:59:17.373087

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql



# revision identifiers, used by Alembic.
revision = '9390211e9153'
down_revision = '45e411cf3a07'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column('support_conversations', 'escalation_reason_code')
    op.drop_column('support_conversations', 'escalation_reference_id')
    op.drop_column('support_conversations', 'closed_at')


def downgrade() -> None:
    op.add_column(
        'support_conversations',
        sa.Column('closed_at', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True),
    )
    op.add_column(
        'support_conversations',
        sa.Column('escalation_reference_id', sa.VARCHAR(length=64), autoincrement=False, nullable=True),
    )
    op.add_column(
        'support_conversations',
        sa.Column('escalation_reason_code', sa.VARCHAR(length=64), autoincrement=False, nullable=True),
    )
