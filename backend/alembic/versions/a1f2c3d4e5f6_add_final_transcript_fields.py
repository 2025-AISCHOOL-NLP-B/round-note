"""add final transcript fields to meeting

Revision ID: a1f2c3d4e5f6
Revises: 9b70d3857f9b_add_assignee_name_to_action_item
Create Date: 2025-12-03
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a1f2c3d4e5f6'
down_revision = '9b70d3857f9b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('MEETING', sa.Column('FINAL_TRANSCRIPT_TEXT', sa.TEXT(), nullable=True))
    op.add_column('MEETING', sa.Column('FINAL_TRANSCRIPT_URL', sa.TEXT(), nullable=True))
    op.add_column('MEETING', sa.Column('FINAL_TRANSCRIPT_STATUS', sa.TEXT(), nullable=True))
    op.add_column('MEETING', sa.Column('FINAL_TRANSCRIPT_ERROR', sa.TEXT(), nullable=True))


def downgrade() -> None:
    op.drop_column('MEETING', 'FINAL_TRANSCRIPT_TEXT')
    op.drop_column('MEETING', 'FINAL_TRANSCRIPT_URL')
    op.drop_column('MEETING', 'FINAL_TRANSCRIPT_STATUS')
    op.drop_column('MEETING', 'FINAL_TRANSCRIPT_ERROR')