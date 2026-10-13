# Workouts Discover API

Owners can publish a saved workout to a shared Discover feed. Other users can browse it, open it, save a private copy, report it or block its contributor. Only the creator's prescription is shared. Code: `api/app/domains/workouts/discover.py`. Tests: `api/tests/test_workouts_discover.py`.

## Availability and gating

- Discover needs optional migration **045** (`api/migrations/045_add_workouts_discover.py`). Until 045 is recorded, the API starts normally. Recipes and private Workouts behave as before, `GET /api/v1/workouts/capabilities` returns `"discover": false`, every Discover route returns `503`, and `publication` in library responses is `null`.
- **Signed-out access is off.** Every route uses the Workouts tester gate (`require_workouts_user`): today only `WORKOUTS_TESTER_USER_IDS`, or every signed-in user once `workouts_public_access_enabled` is on. Recipes Discover allows signed-out reads, but Workouts is still a private beta. Revisit this at public launch.
- Discover reads do not need Workouts enrollment. Saving and publishing need an active enrollment and the `X-Workouts-Generation` header, like other writes.
- Responses are `Cache-Control: no-store`, the same as every `WorkoutsRoute`. They depend on the viewer (blocks, saved copies) and require auth.

## Publishing rules

- `POST /api/v1/workouts/library/{id}/publish` and `/unpublish`. These are owner-only and need the generation header. Both return `PublicationResponse`.
- Publishing reuses the Recipes publishing disclosure (`app_users.publishing_disclosure_version`, `GET/POST /api/users/me/publishing-disclosure`). Without it the API returns `409 "Accept the current publishing disclosure…"`.
- Incomplete workouts can't be public. Every exercise needs reps, time or distance, and every block needs exercises. Otherwise the API returns `422`. If an owner edits a public workout and it becomes incomplete, it is unpublished.
- When accepting an import, send `POST /imports/{id}/accept {"is_public": true}` to publish in the same transaction. **The server default is private**, so older clients never publish by accident. The client should preselect public for link imports (`capture_kind == "url"`) and private for photo, text and document imports, using the same wording as Recipes. An `incomplete` extraction accepted unchanged can't be published.
- Library responses (`GET /library`, `/library/{id}`, saves and edits) include owner-only state: `"publication": {"is_public": true, "moderation_status": "active", "published_at": "…", "discover_visible": true}`.

## Feed: `GET /api/v1/workouts/discover`

Query parameters: `q` (title, source creator or exercise name; max 100 characters), `equipment` (for example `dumbbell`, or `none`/`bodyweight` for no required equipment), `platform` (`youtube`, `tiktok`, `instagram`, `web`, …), `min_minutes`, `max_minutes`, `limit` (1–50, default 20) and `offset`. Results are newest first.

```json
{"items": [{
  "id": "4c0f…", "title": "Ten minute legs", "kind": "session",
  "estimated_minutes": 10, "equipment_required": ["Dumbbell"], "equipment_optional": [],
  "block_count": 1, "exercise_count": 3,
  "source_url": "https://www.youtube.com/watch?v=abc…", "source_platform": "youtube",
  "source_creator": "Coach Nani", "thumbnail_url": null,
  "published_at": "2026-10-13T02:00:00Z",
  "contributor": {"contributor_id": "chef_Q2…", "display_name": "Leon"},
  "is_owner": false, "saved_workout_id": null
}], "total": 1, "limit": 20, "offset": 0, "has_more": false}
```

- **Dedupe:** if several people publish the same source video (matched by canonical key, so `youtu.be/x` and `youtube.com/watch?v=x` are the same), the feed shows one card: the earliest visible publication. The other copies stay in their owners' libraries and can still be opened by id.
- The feed excludes hidden workouts (admin), hidden contributors (`app_users.moderation_status`), contributors the viewer has blocked, and owners whose Workouts data was deleted.
- `thumbnail_url` is always `null` for now. Workouts doesn't store media yet, so show a platform placeholder.
- No body-area filter yet. Saved content has no reliable body-area field.

## Detail: `GET /api/v1/workouts/discover/{id}`

Returns the same card fields plus `"workout"`, a valid `WorkoutContent` built from an allow-list:

```json
{"workout": {"title": "…", "kind": "session", "provenance": "user", "source_url": "…",
  "source_creator": "Coach Nani", "source_title": null, "estimated_minutes": 10,
  "equipment_required": ["Dumbbell"], "equipment_optional": [], "notes": [],
  "blocks": [{"id": "block-1", "label": "Main circuit", "grouping": "circuit", "rounds": 3,
    "rest_between_rounds_seconds": 60, "evidence": [], "exercises": [{"name": "Goblet squat",
    "sets": 3, "reps_min": 12, "reps_max": 12, "rest_seconds": 45, "duration_seconds": null,
    "distance_meters": null, "per_side": null, "tempo": null, "load": null, "load_unit": null,
    "load_convention": null, "exercise_id": null, "effort": null, "notes": null,
    "evidence": [], "provenance": "user"}]}]}}
```

The detail never includes the owner's profile, measurements, limitations, notes, effort or evidence text, adapted versions, sessions, health data, owner or account IDs, generation or revision. It is built on the reviewed share-link projection (`sharing_service.project_workout`). A test fails if a private field appears.

## Actions

| Request | Result |
|---|---|
| `POST /discover/{id}/save` + generation header | `201` with a `LibraryRecordResponse` for the new private copy. A repeat returns `200` with the same copy. Saving your own workout returns `409`. |
| `POST /discover/{id}/report {"category": "spam", "details": "…"}` | `201 {"id","status","created_at"}`. Files a contributor report in the existing admin queue, with details prefixed `Workouts Discover {id}`. |
| `POST /discover/{id}/block` | `201 {"contributor_id","display_name"}`. Hides the contributor's workouts and recipes for the caller. Undo with the shared `DELETE /api/blocks/{contributor_id}`. |
| `GET /admin/discover?moderation_status=all\|active\|hidden` | Admin only (`require_admin`). Lists public or hidden workouts. |
| `PUT /admin/discover/{id}/moderation {"moderation_status": "hidden", "reason": "…"}` | Admin only. Writes an `admin_audit_events` row. Hide a whole contributor with the existing `PUT /api/admin/contributors/{contributor_id}/moderation`, which now resolves any account, not just recipe owners. |

All paths above are relative to `/api/v1/workouts` except `/api/blocks` and `/api/admin`.

## Deletion

Public workouts are rows in the owner's `workouts_library`. `DELETE /api/v1/workouts/data` and whole-account deletion remove them, so they leave Discover immediately. Private copies other people already saved stay in their libraries; this matches Recipes.

## Production rollout

1. Deploy the code. It starts and serves normally without 045; Discover reports unavailable.
2. Create and verify a Neon recovery branch (restore point), as for 034–044.
3. Run the one-off optional migration. Set `WORKOUTS_API_ENABLED=true` for that process only; the serving configuration doesn't change. Use the production `DATABASE_URL`:
   `cd api && WORKOUTS_API_ENABLED=true MIGRATION_045_RESTORE_POINT=<recovery-branch-id> uv run python -m migrations.045_add_workouts_discover`
   It requires 035. It is additive: six nullable or defaulted columns, two CHECK constraints and two partial indexes on `workouts_library`. It replays safely and uses `lock_timeout=5s`, so it fails fast instead of blocking library reads. Production refuses to run it without a restore point.
4. Restart or redeploy so that startup verifies 045 is complete. A recorded but incomplete 045 fails readiness. Then confirm `capabilities.discover == true` for a tester account.

Rollback: older code ignores the new columns, so redeploying an earlier commit is safe without reverting the schema.
