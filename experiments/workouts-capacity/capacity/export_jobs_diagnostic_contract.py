"""Fixed test-only labels and scalar outcomes; no provider or application imports."""

READS = {"/up", "recipes/list", "recipes/detail", "recipes/search"}
ROUTES = READS | {
    "recipes/chat",
    "workouts/export-admit",
    "workouts/export-status",
    "workouts/export-page",
    "workouts/export-cancel",
}
FAILURES = {
    "export_job_identity_failed",
    "export_job_deadline_failed",
    "export_job_terminal",
    "export_job_pages_failed",
    "export_job_ack_failed",
    "export_job_cleanup_failed",
    "export_job_request_failed",
}
STATUS_CODES = {
    "queued": 1,
    "running": 2,
    "cancel_requested": 3,
    "ready": 4,
    "cancelled": 5,
    "failed": 6,
    "expired": 7,
}
OUTCOME_NUMBERS = {
    "admission_ms",
    "poll_count",
    "ready_observed_ms",
    "pages_read",
    "workouts_rows",
    "versions_rows",
    "dataset_count",
    "total_rows",
    "wire_bytes",
}
OUTCOME_BOOLEANS = {
    "original_identity_preserved",
    "all_totals_matched",
    "unique_rows",
    "ready_actual_end_verified",
    "same_job_cancelled",
    "prescriptions_matched",
}
JOB_NUMBERS = {
    "job_count",
    "status_code",
    "slot_rows",
    "active_slot_count",
    "actual_end_ack_count",
    "ack_completion_ms",
    "deadline_window_ms",
    "expiry_window_ms",
    "snapshot_count",
    "page_count",
    "running_registry_count",
    "worker_active_task_count",
    "worker_active_execution_count",
    "worker_pending_ack_count",
    "worker_heartbeat_task_count",
    "worker_retirement_task_count",
}
JOB_BOOLEANS = {"source_frames_retired", "global_slot_idle"}
