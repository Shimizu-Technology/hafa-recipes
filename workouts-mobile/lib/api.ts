import {
  activityQuery,
  type ActivityPage,
  type ActivityRecord,
  type ActivityMutation,
  type ActivityWrite,
} from "./activity-log";
import type { RecipeGrants, RecipeContext } from "./connections";
import type { ExportPage, ExportManifest, SnapshotPage } from "./account";
import type { CoachFocus, CoachHistory, CoachMessage, CoachAction, CoachResult } from "./coach";
import type { ProgramReceipt, SourceChoices, SourceProgramDay } from "./plans";
import type {
  MeasurementKind,
  MeasurementPage,
  MeasurementWrite,
  MeasurementResult,
  Measurement,
} from "./measurements";
import {
  libraryQuery,
  type Organization,
  type OrganizationWrite,
  type Collection,
  type LibraryFilters,
  type LibraryPage,
} from "./organization";
import type { ProviderName, HealthConnection, HealthChoices, SyncBody, ExportIntent } from "./health-client";
import type { HealthObservation, ExportReceipt } from "./health/types";
import type { ShareKind, SharePreview, OwnerShare } from "./sharing";
import type { Capabilities, ImportJob, ExtractionRequest } from "./capture";
import type {
  TrainingProfile,
  Workout,
  AuthoredWorkout,
  Program,
  TrainingSession,
  Enrollment,
  SessionRequest,
} from "./models";
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}
type Token = () => Promise<string | null>;
interface RecordEnvelope<T> {
  id: string;
  generation: number;
  revision: number;
  content: T;
  created_at: string;
  updated_at: string;
  organization?: Organization;
}
interface SessionEnvelope {
  id: string;
  generation: number;
  client_session_id: string;
  content: SessionRequest & { prescription_snapshot: Workout };
  created_at: string;
}
interface RequestOptions {
  generation?: number;
  revision?: number;
  creationKey?: string;
  timeout_ms?: number;
  signal?: AbortSignal;
}
function workoutRecord(row: RecordEnvelope<Workout>): Workout {
  return {
    ...row.content,
    id: row.id,
    generation: row.generation,
    revision: row.revision,
    ...(row.organization ? { organization: row.organization } : {}),
  };
}
export function authoredWorkout(workout: AuthoredWorkout | Workout): AuthoredWorkout {
  const {
    id: _id,
    revision: _revision,
    generation: _generation,
    version: _version,
    parent_version_id: _parent,
    organization: _organization,
    ...body
  } = workout as Workout;
  return body;
}
function programRecord(
  row: RecordEnvelope<{
    title: string;
    proposal: Omit<Program, "id" | "title" | "revision" | "generation" | "schedule_state">;
    schedule_state?: Program["schedule_state"];
  }>
): Program {
  return {
    ...row.content.proposal,
    schedule_state: row.content.schedule_state,
    title: row.content.title,
    id: row.id,
    generation: row.generation,
    revision: row.revision,
  };
}
function sessionRecord(row: SessionEnvelope): TrainingSession {
  const content = row.content;
  return {
    id: row.id,
    generation: row.generation,
    client_session_id: row.client_session_id,
    title: content.prescription_snapshot.title,
    started_at: content.started_at,
    status: content.status,
    duration_minutes: Math.round(
      (new Date(content.finished_at).getTime() - new Date(content.started_at).getTime()) / 60000
    ),
    content,
  };
}
// All wire representations and write preconditions live here. Never update a queued generation.
export interface AccountFence {
  owner?: string;
  binding: string;
  currentBinding(): string | null;
}
export function createWorkoutsApi(
  base: string,
  getToken: Token,
  transport: typeof fetch = fetch,
  account?: AccountFence
) {
  function guardAccount() {
    if (account && account.currentBinding() !== account.binding)
      throw new ApiError("The signed-in account changed. This request was stopped.", 409);
  }
  let membership: Enrollment | null = null;
  let membershipEpoch = 0;
  let revision: number | null = null;
  function currentGeneration(generation?: number) {
    if (generation != null) return generation;
    if (!membership?.enrolled || membership.generation == null)
      throw new ApiError("Set up your Workouts account before saving training.", 403);
    return membership.generation;
  }
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    options: RequestOptions = {}
  ): Promise<{ data: T; headers: Headers }> {
    if (!base) throw new ApiError("The training service is not configured for this build.", 0);
    guardAccount();
    const token = await getToken();
    guardAccount();
    if (!token) throw new ApiError("Sign in again to access your training.", 401);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), options.timeout_ms ?? 20000);
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      if (account?.owner) headers["X-Hafa-Account-ID"] = account.owner;
      if (options.generation != null) headers["X-Workouts-Generation"] = String(options.generation);
      if (options.revision != null) headers["If-Match"] = `"${options.revision}"`;
      if (options.creationKey) headers["Idempotency-Key"] = options.creationKey;
      const response = await transport(
        `${base.replace(/\/$/, "")}${path.startsWith("/api/") ? path : `/api/v1/workouts${path}`}`,
        {
          method,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
        }
      );
      guardAccount();
      if (controller.signal.aborted) throw new ApiError("This request was retired. Refresh before continuing.", 409);
      if (!response.ok) {
        const message =
          response.status === 401
            ? "Your session expired. Sign in again."
            : response.status === 403
              ? "Your Workouts enrollment needs review. Your local draft has not been sent."
              : response.status === 409
                ? "This account or record changed elsewhere. Your local copy is safe; refresh and review before trying again."
                : response.status === 404 || response.status === 503
                  ? "The training service or record is unavailable. Your local draft is safe; try again later."
                  : response.status === 410
                    ? "This saved request or source was cleared or expired. Start a new request deliberately."
                    : response.status === 422
                      ? "Some details could not be saved. Review your entries and try again."
                      : response.status === 429
                        ? "This beta allowance is currently used. Try again after the rolling daily window resets; your draft is safe."
                        : response.status === 428
                          ? "Reload the saved record before editing; a revision is required."
                          : "The training service could not finish this request. Please try again.";
        throw new ApiError(message, response.status);
      }
      const data = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
      guardAccount();
      if (controller.signal.aborted) throw new ApiError("This request was retired. Refresh before continuing.", 409);
      return { data, headers: response.headers };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("Could not reach the training service. Check your connection and try again.", 0);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    }
  }
  async function list<T>(path: string): Promise<T[]> {
    const rows: T[] = [];
    for (let offset = 0; offset <= 1000000; offset += 50) {
      const { data } = await request<T[]>(`${path}?limit=50&offset=${offset}`);
      if (!Array.isArray(data)) throw new ApiError("The training service returned an unexpected list.", 0);
      rows.push(...data);
      if (data.length < 50) return rows;
    }
    throw new ApiError("This library is too large to load at once. Contact support.", 0);
  }
  return {
    async activityLog(generation: number, offset = 0, from?: string, to?: string) {
      const result = (
        await request<ActivityPage>(`/activity-log?${activityQuery(offset, from, to)}`, "GET", undefined, {
          generation,
        })
      ).data;
      if (result.items.some((item) => item.generation !== generation))
        throw new ApiError("Your Workouts enrollment changed. Refresh before reading activity.", 409);
      return result;
    },
    async activity(id: string, generation: number) {
      const result = (
        await request<ActivityRecord>(`/activity-log/${encodeURIComponent(id)}`, "GET", undefined, { generation })
      ).data;
      if (result.generation !== generation)
        throw new ApiError("Your Workouts enrollment changed. Refresh before reading activity.", 409);
      return result;
    },
    async saveActivity(id: string | null, body: ActivityWrite, generation: number) {
      const result = await request<ActivityMutation>(
        id ? `/activity-log/${id}` : "/activity-log",
        id ? "PUT" : "POST",
        body,
        { generation }
      );
      revision = null;
      return result.data;
    },
    async removeActivity(id: string, body: { request_id: string; expected_revision: number }, generation: number) {
      const result = await request<ActivityMutation>(`/activity-log/${id}`, "DELETE", body, { generation });
      revision = null;
      return result.data;
    },
    async recipeGrants(generation: number) {
      return (await request<RecipeGrants>("/connections/recipes/grants", "GET", undefined, { generation })).data;
    },
    async saveRecipeGrants(
      expected_revision: number,
      library_context: boolean,
      meal_plan_context: boolean,
      generation: number
    ) {
      return (
        await request<RecipeGrants>(
          "/connections/recipes/grants",
          "PUT",
          { expected_revision, library_context, meal_plan_context },
          { generation }
        )
      ).data;
    },
    async recipeContext(generation: number, start_date?: string, end_date?: string) {
      const query = new URLSearchParams({
        purpose: "view",
        ...(start_date ? { start_date } : {}),
        ...(end_date ? { end_date } : {}),
      });
      return (await request<RecipeContext>(`/connections/recipes?${query}`, "GET", undefined, { generation })).data;
    },
    async createExportSnapshot(generation: number) {
      return (await request<ExportManifest>("/export/snapshots", "POST", undefined, { generation, timeout_ms: 120000 }))
        .data;
    },
    async exportSnapshotPage(id: string, page: number, generation: number) {
      return (await request<SnapshotPage>(`/export/snapshots/${id}/pages/${page}`, "GET", undefined, { generation }))
        .data;
    },
    async deleteExportSnapshot(id: string, generation: number) {
      await request<void>(`/export/snapshots/${id}`, "DELETE", undefined, { generation });
    },
    async exportPage(generation: number, offset = 0) {
      return (await request<ExportPage>(`/export?limit=10&offset=${offset}`, "GET", undefined, { generation })).data;
    },
    async removeWorkoutsData(generation: number) {
      const { data } = await request<Enrollment>("/data", "DELETE", undefined, { generation });
      membership = data;
      return data;
    },
    async deleteHafaAccount() {
      return (await request<{ message: string; cleanup: { id: string; status: string } }>("/api/users/me", "DELETE"))
        .data;
    },
    async coachHistory(offset = 0) {
      return (await request<CoachHistory>(`/coach/messages?limit=50&offset=${offset}`)).data;
    },
    async coachMessage(request_id: string, message: string, focus: CoachFocus, generation: number) {
      return (
        await request<CoachMessage>(
          "/coach/messages",
          "POST",
          { request_id, message, ...focus },
          { generation, timeout_ms: 120000 }
        )
      ).data;
    },
    async clearCoach(generation: number) {
      return (await request<void>("/coach/messages", "DELETE", undefined, { generation })).data;
    },
    async coachAction(id: string) {
      return (await request<CoachAction>(`/coach/actions/${encodeURIComponent(id)}`)).data;
    },
    async acceptCoachAction(id: string, title: string, confirm_return_baseline: boolean, generation: number) {
      return (
        await request<CoachResult>(
          `/coach/actions/${encodeURIComponent(id)}/accept`,
          "POST",
          { title, ...(confirm_return_baseline ? { confirm_return_baseline: true } : {}) },
          { generation }
        )
      ).data;
    },
    async undoCoachAction(id: string, generation: number) {
      return (
        await request<CoachResult>(`/coach/actions/${encodeURIComponent(id)}/undo`, "POST", undefined, { generation })
      ).data;
    },
    async searchLibrary(filters: LibraryFilters, cursor?: string | null, generation?: number): Promise<LibraryPage> {
      const { data } = await request<Omit<LibraryPage, "items"> & { items: RecordEnvelope<Workout>[] }>(
        `/library/search?${libraryQuery(filters, cursor)}`,
        "GET",
        undefined,
        { generation: currentGeneration(generation) }
      );
      return { ...data, items: data.items.map(workoutRecord) };
    },
    async organization(id: string, generation?: number) {
      return (
        await request<Organization>(`/library/${encodeURIComponent(id)}/organization`, "GET", undefined, {
          generation: currentGeneration(generation),
        })
      ).data;
    },
    async saveOrganization(id: string, body: OrganizationWrite, generation: number) {
      return (
        await request<Organization>(`/library/${encodeURIComponent(id)}/organization`, "PUT", body, { generation })
      ).data;
    },
    async collections(generation?: number) {
      return (
        await request<Collection[]>("/collections", "GET", undefined, { generation: currentGeneration(generation) })
      ).data;
    },
    async createCollection(title: string, generation: number) {
      return (await request<Collection>("/collections", "POST", { title }, { generation })).data;
    },
    async renameCollection(id: string, title: string, expected_revision: number, generation: number) {
      return (
        await request<Collection>(
          `/collections/${encodeURIComponent(id)}`,
          "PUT",
          { title, expected_revision },
          { generation }
        )
      ).data;
    },
    async removeCollection(id: string, expected_revision: number, generation: number) {
      return (
        await request<void>(
          `/collections/${encodeURIComponent(id)}?expected_revision=${expected_revision}`,
          "DELETE",
          undefined,
          { generation }
        )
      ).data;
    },
    async duplicateWorkout(
      id: string,
      request_id: string,
      expected_revision: number,
      title: string | undefined,
      generation: number
    ) {
      return workoutRecord(
        (
          await request<RecordEnvelope<Workout>>(
            `/library/${encodeURIComponent(id)}/duplicate`,
            "POST",
            { request_id, expected_revision, title, copy_organization: true },
            { generation }
          )
        ).data
      );
    },
    async duplicateSources(source_url: string, exclude_id?: string, generation?: number) {
      const query = new URLSearchParams({ source_url, ...(exclude_id ? { exclude_id } : {}) });
      return (
        await request<{
          matches: Array<{ id: string; title: string; revision: number; archived: boolean }>;
          has_more: boolean;
          advisory: true;
        }>(`/library/duplicate-sources?${query}`, "GET", undefined, { generation: currentGeneration(generation) })
      ).data;
    },
    async profileSnapshot() {
      const { data, headers } = await request<TrainingProfile | null>("/profile");
      const rawRevision = headers.get("X-Workouts-Revision");
      const value = rawRevision == null ? NaN : Number(rawRevision);
      if (!Number.isSafeInteger(value) || value < 0)
        throw new ApiError("Reload the profile revision before editing measurements.", 428);
      revision = value;
      return { profile: data, revision: value };
    },
    async measurements(kind: MeasurementKind, generation: number, offset = 0) {
      return (
        await request<MeasurementPage>(
          `/measurements?kind=${kind}&include_deleted=false&limit=25&offset=${offset}`,
          "GET",
          undefined,
          { generation }
        )
      ).data;
    },
    async measurementTrends(kind: MeasurementKind, start_at: string, end_at: string, generation: number) {
      const all: Measurement[] = [];
      for (let offset = 0; offset < 1000; ) {
        const query = new URLSearchParams({ kind, start_at, end_at, limit: "50", offset: String(offset) });
        const { data } = await request<MeasurementPage>(`/measurements/trends?${query}`, "GET", undefined, {
          generation,
        });
        all.push(...data.items);
        if (!data.has_more) return all;
        if (!data.items.length)
          throw new ApiError("The history page could not be continued. Reload your measurements.", 0);
        offset += data.items.length;
      }
      throw new ApiError("This period contains too many measurements. Contact support to review a shorter period.", 0);
    },
    async measurement(id: string, generation: number) {
      return (await request<Measurement>(`/measurements/${encodeURIComponent(id)}`, "GET", undefined, { generation }))
        .data;
    },
    async saveMeasurement(id: string | null, body: MeasurementWrite, profileRevision: number, generation: number) {
      const { data } = await request<MeasurementResult>(
        id ? `/measurements/${encodeURIComponent(id)}` : "/measurements",
        id ? "PUT" : "POST",
        body,
        { generation, revision: profileRevision }
      );
      revision = data.profile_revision;
      return data;
    },
    async removeMeasurement(
      id: string,
      request_id: string,
      expected_revision: number,
      profileRevision: number,
      generation: number
    ) {
      const { data } = await request<MeasurementResult>(
        `/measurements/${encodeURIComponent(id)}/remove`,
        "POST",
        { request_id, expected_revision },
        { generation, revision: profileRevision }
      );
      revision = data.profile_revision;
      return data;
    },
    async identity() {
      return (await request<{ id: string }>("/api/users/me/identity")).data;
    },
    async healthConnection(provider: ProviderName) {
      return (await request<HealthConnection>(`/health/${provider}/connection`)).data;
    },
    async saveHealthConnection(
      provider: ProviderName,
      choices: HealthChoices,
      expected_revision: number,
      generation: number
    ) {
      return (
        await request<HealthConnection>(
          `/health/${provider}/connection`,
          "PUT",
          { ...choices, expected_revision, disclosure_version: 1 },
          { generation }
        )
      ).data;
    },
    async uploadHealth(provider: ProviderName, body: SyncBody, generation: number) {
      return (await request<{ receipt_id: string }>(`/health/${provider}/sync`, "POST", body, { generation })).data;
    },
    async reconcileHealth(
      provider: ProviderName,
      body: { expected_revision: number; window_start: string; window_end: string; receipt_ids: string[] },
      generation: number
    ) {
      return (await request<unknown>(`/health/${provider}/reconcile`, "POST", body, { generation })).data;
    },
    async healthObservations(provider: ProviderName) {
      return await list<HealthObservation>(`/health/${provider}/observations`);
    },
    async prepareHealthExport(
      provider: ProviderName,
      session_id: string,
      expected_revision: number,
      generation: number
    ) {
      return (
        await request<ExportIntent>(
          `/health/${provider}/exports`,
          "POST",
          { session_id, expected_revision },
          { generation }
        )
      ).data;
    },
    async acknowledgeHealthExport(
      provider: ProviderName,
      intent_id: string,
      expected_revision: number,
      receipt: Pick<ExportReceipt, "status" | "source_id">,
      generation: number
    ) {
      return (
        await request<unknown>(
          `/health/${provider}/exports/${encodeURIComponent(intent_id)}/acknowledgment`,
          "POST",
          { expected_revision, ...receipt },
          { generation }
        )
      ).data;
    },
    async previewShare(
      kind: ShareKind,
      id: string,
      expected_revision: number,
      options: {
        title?: string;
        display_name?: string;
        include_source_url?: boolean;
        allow_incomplete?: boolean;
        expires_in_days?: number;
      },
      generation: number
    ) {
      return (
        await request<SharePreview>(
          "/sharing/previews",
          "POST",
          { kind, [kind === "workout" ? "workout_id" : "program_id"]: id, expected_revision, ...options },
          { generation }
        )
      ).data;
    },
    async confirmShare(preview: SharePreview) {
      return (
        await request<OwnerShare>(
          `/sharing/previews/${encodeURIComponent(preview.id)}/confirm`,
          "POST",
          { preview_digest: preview.preview_digest, confirm_public_snapshot: true, disclosure_version: 1 },
          { generation: preview.generation }
        )
      ).data;
    },
    async shares() {
      return (await request<OwnerShare[]>("/sharing")).data;
    },
    async revokeShare(share: OwnerShare) {
      return (
        await request<OwnerShare>(`/sharing/${encodeURIComponent(share.id)}`, "DELETE", undefined, {
          generation: share.generation,
        })
      ).data;
    },
    async copyShare(
      token: string,
      snapshot_digest: string,
      copy_request_id: string,
      generation: number,
      start_date?: string
    ) {
      const r = (
        await request<{
          kind: ShareKind;
          record:
            | RecordEnvelope<Workout>
            | RecordEnvelope<{
                title: string;
                proposal: Omit<Program, "id" | "title" | "revision" | "generation" | "schedule_state">;
                schedule_state?: Program["schedule_state"];
              }>;
          receipt: { id: string };
        }>(
          `/shared/${encodeURIComponent(token)}/copy`,
          "POST",
          {
            copy_request_id,
            snapshot_digest,
            acknowledge_not_personalized: true,
            ...(start_date ? { start_date } : {}),
          },
          { generation }
        )
      ).data;
      return r.kind === "workout"
        ? { kind: r.kind, record: workoutRecord(r.record as RecordEnvelope<Workout>) }
        : {
            kind: r.kind,
            record: programRecord(
              r.record as RecordEnvelope<{
                title: string;
                proposal: Omit<Program, "id" | "title" | "revision" | "generation">;
              }>
            ),
          };
    },
    async capabilities() {
      return (await request<Capabilities>("/capabilities")).data;
    },
    async aiConsent() {
      return (
        await request<{ accepted: boolean; disclosure_version: number; accepted_at: string | null }>("/ai-consent")
      ).data;
    },
    async setAiConsent(accepted: boolean, generation?: number) {
      return (
        await request<{ accepted: boolean }>(
          "/ai-consent",
          "PUT",
          { accepted, disclosure_version: 1 },
          { generation: currentGeneration(generation) }
        )
      ).data;
    },
    async startImport(request_id: string, source: ExtractionRequest, generation: number) {
      return (await request<ImportJob>("/imports", "POST", { request_id, source }, { generation })).data;
    },
    async importSource(id: string) {
      return (
        await request<{ source: ExtractionRequest; expires_at: string }>(`/imports/${encodeURIComponent(id)}/source`)
      ).data.source;
    },
    async importJob(id: string) {
      return (await request<ImportJob>(`/imports/${encodeURIComponent(id)}`)).data;
    },
    async acceptImport(id: string, workout: AuthoredWorkout, generation: number) {
      return workoutRecord(
        (
          await request<RecordEnvelope<Workout>>(
            `/imports/${encodeURIComponent(id)}/accept`,
            "POST",
            { workout: authoredWorkout(workout), acknowledge_warnings: true },
            { generation }
          )
        ).data
      );
    },
    async cancelImport(id: string, generation: number) {
      return (await request<void>(`/imports/${encodeURIComponent(id)}`, "DELETE", undefined, { generation })).data;
    },
    async readiness() {
      return (
        await request<{
          state: "ready" | "limited" | "unknown";
          confirmed_at: string | null;
          expires_at: string | null;
        }>("/readiness")
      ).data;
    },
    async setReadiness(state: "ready" | "limited" | "unknown", generation?: number) {
      return (
        await request<{ state: string; confirmed_at: string; expires_at: string }>(
          "/readiness",
          "PUT",
          { state },
          { generation: currentGeneration(generation) }
        )
      ).data;
    },
    async proposeProgram(
      start_date: string,
      weeks: number,
      profile_revision: number,
      generation?: number,
      sources?: SourceChoices
    ) {
      return (
        await request<{
          id: string;
          generation: number;
          profile_revision: number;
          proposal: Omit<Program, "id" | "title" | "revision" | "generation">;
          expires_at: string;
          accepted_record_id: string | null;
        }>(
          "/program-proposals",
          "POST",
          { start_date, weeks, profile_revision, ...sources },
          { generation: currentGeneration(generation) }
        )
      ).data;
    },
    async proposeSourceProgram(
      workout_id: string,
      workout_revision: number,
      profile_revision: number,
      start_date: string,
      days: SourceProgramDay[],
      reviewed_custom_routines: boolean,
      generation: number
    ) {
      return (
        await request<ProgramReceipt>(
          "/program-proposals/from-source",
          "POST",
          { workout_id, workout_revision, profile_revision, start_date, days, reviewed_custom_routines },
          { generation }
        )
      ).data;
    },
    async reviewCopiedProgram(
      id: string,
      program_revision: number,
      profile_revision: number,
      session_minutes: Record<string, number>,
      reviewed_custom_routines: boolean,
      generation: number,
      session_dates?: Record<string, string>
    ) {
      return (
        await request<ProgramReceipt>(
          `/programs/${encodeURIComponent(id)}/review-proposal`,
          "POST",
          {
            program_revision,
            profile_revision,
            session_minutes,
            reviewed_custom_routines,
            ...(session_dates && Object.keys(session_dates).length ? { session_dates } : {}),
          },
          { generation }
        )
      ).data;
    },
    async acceptProgram(id: string, title: string, generation: number) {
      return programRecord(
        (
          await request<
            RecordEnvelope<{
              title: string;
              proposal: Omit<Program, "id" | "title" | "revision" | "generation" | "schedule_state">;
              schedule_state?: Program["schedule_state"];
            }>
          >(`/program-proposals/${encodeURIComponent(id)}/accept`, "POST", { title }, { generation })
        ).data
      );
    },
    commitEnrollment(member: Enrollment) {
      guardAccount();
      membershipEpoch++;
      membership = member;
    },
    async enrollment(options?: { signal?: AbortSignal }) {
      const captured = membershipEpoch;
      const result = await request<Enrollment>("/enrollment", "GET", undefined, { signal: options?.signal });
      if (captured !== membershipEpoch || (membership?.generation != null && result.data.generation != null && result.data.generation < membership.generation))
        throw new ApiError("Enrollment changed while this request was pending. Refresh before continuing.", 409);
      membership = result.data;
      return result.data;
    },
    async enroll(adult_confirmed: boolean, expectedGeneration?: number | null) {
      membershipEpoch++;
      const result = await request<Enrollment>("/enrollment", "POST", {
        adult_confirmed,
        shared_account_deletion_acknowledged: true,
        disclosure_version: 1,
        ...(expectedGeneration == null ? {} : { expected_generation: expectedGeneration }),
      });
      membershipEpoch++;
      membership = result.data;
      return result.data;
    },
    generation: () => membership?.generation ?? null,
    profileRevision: () => revision,
    async profile() {
      const r = await request<TrainingProfile | null>("/profile");
      const raw = r.headers.get("X-Workouts-Revision");
      const parsed = raw == null ? NaN : Number(raw);
      revision = Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
      return r.data;
    },
    async saveProfile(profile: TrainingProfile, expectedRevision = revision, generation?: number) {
      if (expectedRevision == null) throw new ApiError("Reload the saved profile before editing.", 428);
      const r = await request<TrainingProfile>("/profile", "PUT", profile, {
        generation: currentGeneration(generation),
        revision: expectedRevision,
      });
      revision = Number(r.headers.get("X-Workouts-Revision"));
      return r.data;
    },
    async library() {
      return (await list<RecordEnvelope<Workout>>("/library")).map(workoutRecord);
    },
    async workout(id: string) {
      return workoutRecord((await request<RecordEnvelope<Workout>>(`/library/${encodeURIComponent(id)}`)).data);
    },
    async saveWorkout(workout: AuthoredWorkout, creationKey?: string, generation?: number) {
      return workoutRecord(
        (
          await request<RecordEnvelope<Workout>>("/library", "POST", authoredWorkout(workout), {
            generation: currentGeneration(generation),
            creationKey,
          })
        ).data
      );
    },
    async updateWorkout(workout: Workout) {
      return workoutRecord(
        (
          await request<RecordEnvelope<Workout>>(
            `/library/${encodeURIComponent(workout.id)}?expected_revision=${workout.revision}`,
            "PUT",
            authoredWorkout(workout),
            { generation: workout.generation }
          )
        ).data
      );
    },
    async programs() {
      return (
        await list<
          RecordEnvelope<{
            title: string;
            proposal: Omit<Program, "id" | "title" | "revision" | "generation" | "schedule_state">;
            schedule_state?: Program["schedule_state"];
          }>
        >("/programs")
      ).map(programRecord);
    },
    async program(id: string) {
      return programRecord(
        (
          await request<
            RecordEnvelope<{
              title: string;
              proposal: Omit<Program, "id" | "title" | "revision" | "generation" | "schedule_state">;
              schedule_state?: Program["schedule_state"];
            }>
          >(`/programs/${encodeURIComponent(id)}`)
        ).data
      );
    },
    async updateProgram(program: Program) {
      const { id, title, revision: rev, generation, schedule_state: _schedule, ...proposal } = program;
      return programRecord(
        (
          await request<
            RecordEnvelope<{
              title: string;
              proposal: Omit<Program, "id" | "title" | "revision" | "generation" | "schedule_state">;
              schedule_state?: Program["schedule_state"];
            }>
          >(`/programs/${encodeURIComponent(id)}?expected_revision=${rev}`, "PUT", { title, proposal }, { generation })
        ).data
      );
    },
    async sessions() {
      return (await list<SessionEnvelope>("/sessions")).map(sessionRecord);
    },
    async session(id: string) {
      return sessionRecord((await request<SessionEnvelope>(`/sessions/${encodeURIComponent(id)}`)).data);
    },
    async saveSession(body: SessionRequest, generation: number) {
      return sessionRecord((await request<SessionEnvelope>("/sessions", "POST", body, { generation })).data);
    },
  };
}
export type WorkoutsApi = ReturnType<typeof createWorkoutsApi>;
