"""Add token usage tracking

Revision ID: 004_token_usage
Revises: 003_notifications
Create Date: 2026-05-28 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "004_token_usage"
down_revision: Union[str, None] = "003_notifications"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "token_usage",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("call_type", sa.String(50), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cache_read_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cache_creation_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("estimated_cost_usd", sa.Float(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_token_usage_call_type", "token_usage", ["call_type"])
    op.create_index("ix_token_usage_created_at", "token_usage", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_token_usage_created_at", table_name="token_usage")
    op.drop_index("ix_token_usage_call_type", table_name="token_usage")
    op.drop_table("token_usage")
