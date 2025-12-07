"""add speaker mapping column to meeting

Revision ID: add_speaker_mapping
Revises: add_translation_status
Create Date: 2025-12-07 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'add_speaker_mapping'
down_revision = 'add_translation_status'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add SPEAKER_MAPPING JSONB column to MEETING."""
    op.add_column('MEETING', sa.Column('SPEAKER_MAPPING', postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    """Remove SPEAKER_MAPPING column from MEETING."""
    op.drop_column('MEETING', 'SPEAKER_MAPPING')