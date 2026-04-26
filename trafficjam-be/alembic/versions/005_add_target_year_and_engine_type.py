"""add target_year to scenarios and engine_type to runs

Revision ID: 005
Revises: 004
Create Date: 2026-04-26 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM
from alembic import op

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "scenarios",
        sa.Column("target_year", sa.Integer(), nullable=False, server_default="2026"),
    )
    op.execute("CREATE TYPE enginetype AS ENUM ('MATSIM', 'WORLDMOVE')")
    op.add_column(
        "runs",
        sa.Column("engine_type", ENUM(name="enginetype", create_type=False), nullable=False, server_default="MATSIM"),
    )


def downgrade() -> None:
    op.drop_column("runs", "engine_type")
    op.execute("DROP TYPE enginetype")
    op.drop_column("scenarios", "target_year")
