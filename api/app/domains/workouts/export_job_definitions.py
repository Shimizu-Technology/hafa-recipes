"""Canonical045 trigger bodies shared by installation and fail-closed verification."""

EXPORT_JOB_FUNCTION_BODIES = {
    "fence_workouts_export_job_identity": """ BEGIN
      IF (NEW.id,NEW.app_user_id,NEW.generation,NEW.request_id,NEW.kind,NEW.snapshot_id,
          NEW.permission_digest,NEW.admitted_at,NEW.deadline_at,NEW.expires_at)
        IS DISTINCT FROM
         (OLD.id,OLD.app_user_id,OLD.generation,OLD.request_id,OLD.kind,OLD.snapshot_id,
          OLD.permission_digest,OLD.admitted_at,OLD.deadline_at,OLD.expires_at) THEN
        RAISE EXCEPTION 'Export job admission identity is immutable';
      END IF;
      IF OLD.started_at IS NOT NULL AND
        (NEW.started_at,NEW.worker_instance,NEW.worker_identity,NEW.lease_token)
        IS DISTINCT FROM (OLD.started_at,OLD.worker_instance,OLD.worker_identity,OLD.lease_token) THEN
        RAISE EXCEPTION 'A started export never resumes with another source';
      END IF;
      IF OLD.finished_at IS NOT NULL AND NEW.finished_at IS DISTINCT FROM OLD.finished_at THEN
        RAISE EXCEPTION 'Export job completion time is immutable';
      END IF;
      IF OLD.manifest IS NOT NULL AND NEW.manifest IS NOT NULL
         AND NEW.manifest IS DISTINCT FROM OLD.manifest THEN
        RAISE EXCEPTION 'Export manifest is immutable';
      END IF;
      RETURN NEW;
    END """,
    "fence_workouts_export_job_slot": """ BEGIN
      IF NEW.slot IS DISTINCT FROM OLD.slot THEN
        RAISE EXCEPTION 'Export admission slot is immutable';
      END IF;
      IF OLD.active_job_id IS NOT NULL AND NEW.active_job_id IS NOT NULL
         AND NEW.active_job_id IS DISTINCT FROM OLD.active_job_id THEN
        RAISE EXCEPTION 'An occupied export slot cannot be replaced';
      END IF;
      IF OLD.active_job_id IS NOT NULL AND NEW.active_job_id=OLD.active_job_id THEN
        IF (NEW.snapshot_id,NEW.admitted_at,NEW.deadline_at)
          IS DISTINCT FROM (OLD.snapshot_id,OLD.admitted_at,OLD.deadline_at) THEN
          RAISE EXCEPTION 'Export slot admission is immutable';
        END IF;
        IF OLD.started_at IS NOT NULL AND
          (NEW.started_at,NEW.worker_instance,NEW.worker_identity,NEW.lease_token)
          IS DISTINCT FROM (OLD.started_at,OLD.worker_instance,OLD.worker_identity,OLD.lease_token) THEN
          RAISE EXCEPTION 'Started export identity survives erasure';
        END IF;
      END IF;
      IF OLD.active_job_id IS NOT NULL AND NEW.active_job_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM workouts_export_job_recovery
        WHERE job_id=OLD.active_job_id AND worker_instance IS NOT DISTINCT FROM OLD.worker_instance
          AND released_at>=OLD.admitted_at
          AND (OLD.started_at IS NULL OR reason IN ('actual_end','same_namespace_dead','verified_operator'))
      ) THEN
        RAISE EXCEPTION 'Actual export end evidence is required';
      END IF;
      RETURN NEW;
    END """,
    "reject_export_slot_deletion": """ BEGIN
      RAISE EXCEPTION 'Persistent export slot must not be deleted';
    END """,
    "reject_export_recovery_update": """ BEGIN
      RAISE EXCEPTION 'Export termination evidence is immutable';
    END """,
}

# PostgreSQL canonical expressions for045, captured from the reviewed schema.
EXPORT_JOB_CONSTRAINTS = {
    ("workouts_export_job_recovery", "ck_workouts_export_recovery_digest"): (
        "c",
        "CHECK ((length((evidence_digest)::text) = 64))",
    ),
    ("workouts_export_job_recovery", "ck_workouts_export_recovery_reason"): (
        "c",
        "CHECK (((reason)::text "
        "= ANY "
        "((ARRAY['never_started'::character "
        "varying, "
        "'actual_end'::character "
        "varying, "
        "'same_namespace_dead'::character "
        "varying, "
        "'verified_operator'::character "
        "varying])::text[])))",
    ),
    ("workouts_export_job_recovery", "workouts_export_job_recovery_pkey"): (
        "p",
        "PRIMARY KEY (id)",
    ),
    ("workouts_export_job_slot", "ck_workouts_export_job_singleton"): ("c", "CHECK ((slot = 1))"),
    ("workouts_export_job_slot", "ck_workouts_export_slot_admission"): (
        "c",
        "CHECK (((active_job_id IS "
        "NULL) OR ((snapshot_id IS "
        "NOT NULL) AND (admitted_at "
        "IS NOT NULL) AND "
        "(deadline_at IS NOT "
        "NULL))))",
    ),
    ("workouts_export_job_slot", "ck_workouts_export_slot_execution"): (
        "c",
        "CHECK (((started_at IS NULL) "
        "OR ((worker_instance IS NOT "
        "NULL) AND (worker_identity "
        "IS NOT NULL) AND "
        "(lease_token IS NOT "
        "NULL))))",
    ),
    ("workouts_export_job_slot", "ck_workouts_export_slot_identity"): (
        "c",
        "CHECK (((worker_identity IS "
        "NULL) OR "
        "((jsonb_typeof(worker_identity) "
        "= 'object'::text) AND "
        "(octet_length((worker_identity)::text) "
        "<= 2048))))",
    ),
    ("workouts_export_job_slot", "ck_workouts_export_slot_lease"): (
        "c",
        "CHECK (((leased_until IS NULL) OR (leased_until <= deadline_at)))",
    ),
    ("workouts_export_job_slot", "workouts_export_job_slot_pkey"): ("p", "PRIMARY KEY (slot)"),
    ("workouts_export_jobs", "ck_workouts_export_job_deadlines"): (
        "c",
        "CHECK (((deadline_at = "
        "(admitted_at + "
        "'00:02:00'::interval)) AND "
        "(expires_at = (admitted_at + "
        "'00:10:00'::interval))))",
    ),
    ("workouts_export_jobs", "ck_workouts_export_job_digest"): (
        "c",
        "CHECK ((octet_length(permission_digest) = 32))",
    ),
    ("workouts_export_jobs", "ck_workouts_export_job_execution"): (
        "c",
        "CHECK (((started_at IS NULL) OR "
        "((worker_instance IS NOT NULL) "
        "AND (worker_identity IS NOT NULL) "
        "AND (lease_token IS NOT NULL))))",
    ),
    ("workouts_export_jobs", "ck_workouts_export_job_failure"): (
        "c",
        "CHECK (((failure_code IS NULL) OR "
        "((failure_code)::text = ANY "
        "((ARRAY['interrupted'::character "
        "varying, "
        "'privacy_changed'::character "
        "varying, "
        "'deadline_exceeded'::character "
        "varying, 'too_large'::character "
        "varying, 'export_failed'::character "
        "varying])::text[]))))",
    ),
    ("workouts_export_jobs", "ck_workouts_export_job_generation"): (
        "c",
        "CHECK ((generation > 0))",
    ),
    ("workouts_export_jobs", "ck_workouts_export_job_identity"): (
        "c",
        "CHECK (((worker_identity IS NULL) "
        "OR ((jsonb_typeof(worker_identity) "
        "= 'object'::text) AND "
        "(octet_length((worker_identity)::text) "
        "<= 2048))))",
    ),
    ("workouts_export_jobs", "ck_workouts_export_job_kind"): (
        "c",
        "CHECK (((kind)::text = ANY "
        "((ARRAY['async'::character varying, "
        "'legacy'::character "
        "varying])::text[])))",
    ),
    ("workouts_export_jobs", "ck_workouts_export_job_lease"): (
        "c",
        "CHECK (((leased_until IS NULL) OR (leased_until <= deadline_at)))",
    ),
    ("workouts_export_jobs", "ck_workouts_export_job_manifest"): (
        "c",
        "CHECK (((manifest IS NULL) OR "
        "((jsonb_typeof(manifest) = "
        "'object'::text) AND "
        "(octet_length((manifest)::text) <= "
        "16384))))",
    ),
    ("workouts_export_jobs", "ck_workouts_export_job_started"): (
        "c",
        "CHECK (((started_at IS NULL) OR (started_at >= admitted_at)))",
    ),
    ("workouts_export_jobs", "ck_workouts_export_job_status"): (
        "c",
        "CHECK (((status)::text = ANY "
        "((ARRAY['queued'::character varying, "
        "'running'::character varying, "
        "'cancel_requested'::character "
        "varying, 'ready'::character varying, "
        "'cancelled'::character varying, "
        "'failed'::character varying, "
        "'expired'::character "
        "varying])::text[])))",
    ),
    ("workouts_export_jobs", "uq_workouts_export_job_request"): (
        "u",
        "UNIQUE (app_user_id, generation, request_id)",
    ),
    ("workouts_export_jobs", "uq_workouts_export_job_snapshot"): ("u", "UNIQUE (snapshot_id)"),
    ("workouts_export_jobs", "workouts_export_jobs_app_user_id_fkey"): (
        "f",
        "FOREIGN KEY (app_user_id) REFERENCES app_users(id) ON DELETE CASCADE",
    ),
    ("workouts_export_jobs", "workouts_export_jobs_pkey"): ("p", "PRIMARY KEY (id)"),
}

EXPORT_JOB_TRIGGERS = {
    ("workouts_export_job_recovery", "immutable_workouts_export_job_recovery"): (
        19,
        "reject_export_recovery_update",
    ),
    ("workouts_export_job_slot", "fence_workouts_export_job_slot"): (
        19,
        "fence_workouts_export_job_slot",
    ),
    ("workouts_export_job_slot", "persistent_workouts_export_job_slot"): (
        11,
        "reject_export_slot_deletion",
    ),
    ("workouts_export_jobs", "fence_workouts_export_job_identity"): (
        19,
        "fence_workouts_export_job_identity",
    ),
}
