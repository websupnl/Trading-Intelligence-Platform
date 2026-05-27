"""Add measurable signal outcomes

Revision ID: 002_signal_outcomes
Revises: 001_initial
Create Date: 2026-05-27 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002_signal_outcomes"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "signal_outcomes",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("signal_id", sa.String(), nullable=False, unique=True),
        sa.Column("symbol", sa.String(20), nullable=False),
        sa.Column("direction", sa.String(10), nullable=False),
        sa.Column("signal_created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("entry_price", sa.Float(), nullable=True),
        sa.Column("entry_source", sa.String(40), default="suggested_entry"),
        sa.Column("return_1d", sa.Float(), nullable=True),
        sa.Column("return_5d", sa.Float(), nullable=True),
        sa.Column("pnl_1d_pct", sa.Float(), nullable=True),
        sa.Column("pnl_5d_pct", sa.Float(), nullable=True),
        sa.Column("mfe_pct", sa.Float(), nullable=True),
        sa.Column("mae_pct", sa.Float(), nullable=True),
        sa.Column("benchmark_symbol", sa.String(20), default="SPY"),
        sa.Column("benchmark_return_5d", sa.Float(), nullable=True),
        sa.Column("excess_return_5d", sa.Float(), nullable=True),
        sa.Column("outcome_status", sa.String(20), default="pending"),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_signal_outcomes_signal_id", "signal_outcomes", ["signal_id"])
    op.create_index("ix_signal_outcomes_symbol", "signal_outcomes", ["symbol"])


def downgrade() -> None:
    op.drop_index("ix_signal_outcomes_symbol", table_name="signal_outcomes")
    op.drop_index("ix_signal_outcomes_signal_id", table_name="signal_outcomes")
    op.drop_table("signal_outcomes")
