"""SQLAlchemy models matching existing Drizzle schema in Neon database."""

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class Recipe(Base):
    """
    Recipe model - matches existing 'recipes' table in Neon.
    
    The 'extracted' JSONB column contains the full recipe data including:
    - title, servings, times
    - components (new multi-component structure)
    - ingredients, steps (legacy fields)
    - equipment, notes, tags
    - nutrition, cost info
    """
    __tablename__ = "recipes"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_url = Column(Text, nullable=False)
    canonical_source_key = Column(String(96), nullable=True, index=True)
    source_type = Column(String(32), nullable=False)  # video|website|manual|photo|text
    raw_text = Column(Text, nullable=True)
    extracted = Column(JSONB, nullable=False)
    original_extracted = Column(JSONB, nullable=True)  # Stores original AI extraction before user edits
    thumbnail_url = Column(Text, nullable=True)
    extraction_method = Column(String(32), nullable=True)  # whisper|basic|oembed|manual|ocr|text-ai
    extraction_quality = Column(String(16), nullable=True)  # high|medium|low
    has_audio_transcript = Column(Boolean, default=False)
    review_state = Column(String(24), nullable=True, index=True)
    extraction_evidence = Column(JSONB, nullable=True)
    content_revision = Column(Integer, nullable=False, default=1, server_default="1")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Stable application-user ownership - nullable for legacy recipes
    user_id = Column(
        String(64),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    
    # Display name of the user who extracted this recipe
    # Shown on Discover cards as "by Alanna" or "by lmshimizu"
    extractor_display_name = Column(String(100), nullable=True)
    
    # Public visibility - True means visible in Discover feed
    # Legacy recipes (user_id=NULL) are public by default
    is_public = Column(Boolean, nullable=False, default=False, server_default="false")

    # Moderation is deliberately independent from the owner's sharing choice.
    # Hiding a recipe is reversible and never silently rewrites is_public.
    moderation_status = Column(
        String(16), nullable=False, default="active", server_default="active", index=True
    )
    moderation_updated_at = Column(DateTime(timezone=True), nullable=True)
    is_featured = Column(Boolean, nullable=False, default=False, server_default="false")
    featured_order = Column(Integer, nullable=True, index=True)
    
    # Cached total cook time in minutes for efficient SQL filtering
    # Parsed from extracted["times"]["total"] when recipe is created/updated
    total_minutes = Column(Integer, nullable=True, index=True)
    
    # Relationship to extraction jobs
    extraction_jobs = relationship(
        "ExtractionJob",
        back_populates="recipe",
        foreign_keys="ExtractionJob.recipe_id",
    )

    __table_args__ = (
        CheckConstraint(
            "review_state IS NULL OR review_state IN "
            "('source_incomplete', 'needs_review', 'ready')",
            name="ck_recipes_review_state",
        ),
        CheckConstraint(
            "content_revision >= 1",
            name="ck_recipes_content_revision",
        ),
        CheckConstraint(
            "review_state IS NULL OR review_state = 'ready' OR is_public = FALSE",
            name="ck_recipes_review_public",
        ),
    )
    
    def __repr__(self):
        title = self.extracted.get("title", "Untitled") if self.extracted else "Untitled"
        return f"<Recipe {self.id}: {title}>"


class SavedRecipe(Base):
    """
    SavedRecipe model - tracks which recipes users have bookmarked/saved.
    
    Allows users to save public recipes from other users to their collection.
    """
    __tablename__ = "saved_recipes"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        String(64),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    recipe_id = Column(UUID(as_uuid=True), ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationship to recipe
    recipe = relationship("Recipe")

    __table_args__ = (
        UniqueConstraint("user_id", "recipe_id", name="uq_saved_recipes_user_recipe"),
    )
    
    def __repr__(self):
        return f"<SavedRecipe user={self.user_id} recipe={self.recipe_id}>"


class Collection(Base):
    """
    Collection model - user-created folders for organizing recipes.
    
    Users can create collections like "Weeknight Dinners", "Holiday Favorites", etc.
    """
    __tablename__ = "collections"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        String(64),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(100), nullable=False)
    emoji = Column(String(10), nullable=True)  # Optional emoji icon
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationship to recipes via junction table
    recipes = relationship("Recipe", secondary="collection_recipes", backref="collections")
    
    def __repr__(self):
        return f"<Collection {self.id}: {self.name}>"


class CollectionRecipe(Base):
    """
    CollectionRecipe model - junction table for many-to-many relationship
    between collections and recipes.
    """
    __tablename__ = "collection_recipes"
    
    collection_id = Column(UUID(as_uuid=True), ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True)
    recipe_id = Column(UUID(as_uuid=True), ForeignKey("recipes.id", ondelete="CASCADE"), primary_key=True)
    added_at = Column(DateTime(timezone=True), server_default=func.now())
    
    def __repr__(self):
        return f"<CollectionRecipe collection={self.collection_id} recipe={self.recipe_id}>"


class RecipeNote(Base):
    """
    RecipeNote model - user's private notes on any recipe.
    
    Allows users to add personal notes to any recipe (their own or saved from others).
    Notes are private - only visible to the user who created them.
    """
    __tablename__ = "recipe_notes"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        String(64),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    recipe_id = Column(UUID(as_uuid=True), ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False, index=True)
    note_text = Column(Text, nullable=False, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationship to recipe
    recipe = relationship("Recipe")
    
    def __repr__(self):
        return f"<RecipeNote user={self.user_id} recipe={self.recipe_id}>"


class RecipeVersion(Base):
    """
    RecipeVersion model - tracks all versions of a recipe.
    
    Stores snapshots of the recipe data whenever it's edited or re-extracted.
    Allows users to view history and restore to any previous version.
    """
    __tablename__ = "recipe_versions"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipe_id = Column(UUID(as_uuid=True), ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    extracted = Column(JSONB, nullable=False)  # Snapshot of recipe data
    thumbnail_url = Column(Text, nullable=True)
    review_state = Column(String(24), nullable=True)
    extraction_evidence = Column(JSONB, nullable=True)
    content_revision = Column(Integer, nullable=True)
    change_type = Column(String(32), nullable=False, default="edit")  # initial, edit, re-extract
    change_summary = Column(Text, nullable=True)  # Optional description of changes
    created_by = Column(
        String(64),
        ForeignKey("app_users.id", ondelete="SET NULL"),
        nullable=True,
    )  # User who made the change
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationship to recipe
    recipe = relationship("Recipe", backref="versions")

    __table_args__ = (
        CheckConstraint(
            "review_state IS NULL OR review_state IN "
            "('source_incomplete', 'needs_review', 'ready')",
            name="ck_recipe_versions_review_state",
        ),
        CheckConstraint(
            "content_revision IS NULL OR content_revision >= 1",
            name="ck_recipe_versions_content_revision",
        ),
        UniqueConstraint(
            "recipe_id",
            "version_number",
            name="uq_recipe_versions_recipe_number",
        ),
    )
    
    def __repr__(self):
        return f"<RecipeVersion recipe={self.recipe_id} v{self.version_number}>"


class RecipeCorrectionEvent(Base):
    """Aggregate edit telemetry that never stores recipe field values."""

    __tablename__ = "recipe_correction_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipe_id = Column(
        UUID(as_uuid=True),
        ForeignKey("recipes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(64),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_kind = Column(String(24), nullable=False)
    source_type = Column(String(32), nullable=False)
    extraction_method = Column(String(64), nullable=True)
    from_review_state = Column(String(24), nullable=True)
    to_review_state = Column(String(24), nullable=True)
    content_revision = Column(Integer, nullable=False)
    changed_field_count = Column(Integer, nullable=False)
    ingredient_name_change_count = Column(Integer, nullable=False)
    quantity_change_count = Column(Integer, nullable=False)
    unit_change_count = Column(Integer, nullable=False)
    ingredient_note_change_count = Column(Integer, nullable=False)
    step_change_count = Column(Integer, nullable=False)
    time_change_count = Column(Integer, nullable=False)
    title_changed = Column(Boolean, nullable=False)
    servings_changed = Column(Boolean, nullable=False)
    other_change_count = Column(Integer, nullable=False)
    resolved_missing_quantity_count = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)

    __table_args__ = (
        CheckConstraint(
            "event_kind IN ('review_correction', 'review_verification', 'customization')",
            name="ck_recipe_correction_events_kind",
        ),
        CheckConstraint(
            "from_review_state IS NULL OR from_review_state IN "
            "('source_incomplete', 'needs_review', 'ready')",
            name="ck_recipe_correction_events_from_state",
        ),
        CheckConstraint(
            "to_review_state IS NULL OR to_review_state IN "
            "('source_incomplete', 'needs_review', 'ready')",
            name="ck_recipe_correction_events_to_state",
        ),
        CheckConstraint(
            "content_revision >= 1 AND changed_field_count >= 0 "
            "AND ingredient_name_change_count >= 0 "
            "AND quantity_change_count >= 0 AND unit_change_count >= 0 "
            "AND ingredient_note_change_count >= 0 AND step_change_count >= 0 "
            "AND time_change_count >= 0 AND other_change_count >= 0 "
            "AND resolved_missing_quantity_count >= 0",
            name="ck_recipe_correction_events_nonnegative",
        ),
    )


class ExtractionJob(Base):
    """
    Extraction job model - matches existing 'extraction_jobs' table in Neon.
    
    Tracks the progress of recipe extraction from video URLs.
    """
    __tablename__ = "extraction_jobs"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    url = Column(Text, nullable=False, index=True)
    user_id = Column(
        String(64),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    location = Column(Text, nullable=False, default="Guam")
    notes = Column(Text, nullable=False, default="")
    status = Column(String(16), nullable=False, default="queued", server_default="queued")
    job_kind = Column(String(16), nullable=False, default="extract", server_default="extract")
    requested_is_public = Column(Boolean, nullable=False, default=False, server_default="false")
    requested_display_name = Column(
        String(100), nullable=False, default="A chef", server_default="A chef"
    )
    target_recipe_id = Column(
        UUID(as_uuid=True),
        ForeignKey("recipes.id", ondelete="SET NULL"),
        nullable=True,
    )
    idempotency_key = Column(String(128), nullable=True)
    progress = Column(Integer, nullable=False, default=0)  # 0-100
    current_step = Column(String(32), nullable=False, default="initializing")
    message = Column(Text, nullable=False, default="Starting extraction...")
    estimated_duration = Column(Integer, nullable=False, default=60)  # seconds
    recipe_id = Column(UUID(as_uuid=True), ForeignKey("recipes.id"), nullable=True)
    error_message = Column(Text, nullable=True)
    error_code = Column(String(64), nullable=True)
    lease_token = Column(String(64), nullable=True)
    leased_until = Column(DateTime(timezone=True), nullable=True)
    heartbeat_at = Column(DateTime(timezone=True), nullable=True)
    attempt_count = Column(Integer, nullable=False, default=0, server_default="0")
    max_attempts = Column(Integer, nullable=False, default=3, server_default="3")
    next_attempt_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    low_confidence = Column(Boolean, nullable=True, default=False)  # True if extraction quality is uncertain
    confidence_warning = Column(Text, nullable=True)  # Warning message for low confidence
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationship to recipe
    recipe = relationship("Recipe", back_populates="extraction_jobs", foreign_keys=[recipe_id])
    target_recipe = relationship("Recipe", foreign_keys=[target_recipe_id])
    
    def __repr__(self):
        return f"<ExtractionJob {self.id}: {self.status}>"
