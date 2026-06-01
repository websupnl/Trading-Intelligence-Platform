"""Merge regime and polymarket migration heads

Revision ID: 007_merge_heads
Revises: 006_regime_states, 005_polymarket
Create Date: 2026-06-01 19:45:00.000000

"""
from typing import Sequence, Union


revision: str = "007_merge_heads"
down_revision: Union[str, tuple[str, str], None] = ("006_regime_states", "005_polymarket")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
