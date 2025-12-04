"""add translation status fields

Revision ID: add_translation_status
Revises: a1f2c3d4e5f6
Create Date: 2025-12-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_translation_status'
down_revision = 'a1f2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    # Add translation status fields to MEETING table
    op.add_column('MEETING', sa.Column('TRANSLATION_STATUS', sa.TEXT(), nullable=True))
    op.add_column('MEETING', sa.Column('TRANSLATION_ERROR', sa.TEXT(), nullable=True))
    op.add_column('MEETING', sa.Column('TRANSLATION_TARGET_LANG', sa.TEXT(), nullable=True))
    
    # Add translation status fields to SUMMARY table
    op.add_column('SUMMARY', sa.Column('TRANSLATION_STATUS', sa.TEXT(), nullable=True))
    op.add_column('SUMMARY', sa.Column('TRANSLATION_ERROR', sa.TEXT(), nullable=True))
    op.add_column('SUMMARY', sa.Column('TRANSLATION_TARGET_LANG', sa.TEXT(), nullable=True))


def downgrade():
    # Remove translation status fields from SUMMARY table
    op.drop_column('SUMMARY', 'TRANSLATION_TARGET_LANG')
    op.drop_column('SUMMARY', 'TRANSLATION_ERROR')
    op.drop_column('SUMMARY', 'TRANSLATION_STATUS')
    
    # Remove translation status fields from MEETING table
    op.drop_column('MEETING', 'TRANSLATION_TARGET_LANG')
    op.drop_column('MEETING', 'TRANSLATION_ERROR')
    op.drop_column('MEETING', 'TRANSLATION_STATUS')
