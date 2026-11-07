import type {
  Attachment,
  Bootstrap,
  BabyRecord,
  ChatResult,
  DueReminder,
  EventOccurrence,
  SuggestionResult,
  Child,
  Conversation,
  FeedAction,
  ImportJob,
  Kind,
  PrefsPatch,
  Profile,
  ReminderPrefs,
  SessionAction,
  RecordPage,
  RecordWrite,
  Scope,
  UpcomingReminder,
} from "./models";
import type { CareDay } from "./tracker";
import type { CareStats, StatsChoice } from "./care-stats";
import type { ChangesAnswer } from "./changes";
import { disclosureVersion, type FamilyInvite, type FamilyMember, type FamilyReadiness, type InvitePreview } from "./family";
import type { TappedReminder } from "./notification-route";
import type { Moved } from "./outbox";
import { rowFence, spacesLive, unavailableMessage } from "./spaces";
import { dailyAiLimitMessage } from "./import-status";
/**
 * What this build tells the API it understands, as `X-Baby-Client`. 2 reads and writes every current kind and field, in
 * the personal space only, with no space header. Client 3 is every space, and writes name theirs.
 *
 * The API decides which applies. With its family flag off it treats client 3 as a legacy client, with no calendar, so a
 * build can't just send 3. Bootstrap is the one request that always does, as it answers the same either way and lists
 * spaces only with the flag on. Everything else follows the last answer this phone kept, so the build works on both
 * sides of the flag and takes up the change on its next bootstrap. Until then client 2 still reads and writes personal.
 */
export const babyClient = 2 as const;
export const familyClient = 3 as const;
export const sendsCareDetails = true;
/** What a write is fenced by: a generation, and the space it's for. A bare generation is the personal space's. */
export type Fence = number | { generation: number; space_id?: string | null };
/**
 * Only what a screen is changing, never the whole cached profile. A phone may have read it a while ago, so sending all of
 * it could undo another phone's newer change, withdrawn AI permission included. The two keys below make a spread not compile.
 */
export type ProfileChange = Partial<Pick<Profile, "display_name" | "timezone" | "ai_consent" | "auto_process_shares">> & {
  acknowledge_ai_consent_version?: number;
  auto_process_epoch?: never;
  ai_consent_version?: never;
};
const seriesLimit = "You can keep up to 200 repeating events";
export const seriesLimitMessage = `${seriesLimit}. Delete one you no longer need, or save this one without repeating.`;
/** Fixed server-owned 422 messages that tell the parent what to do next. Any other detail stays private. */
const knownDetails = new Set([
  "Add the birth date to see what is relevant now",
  "Add a due date or birth date to see what is relevant now",
  "Add a due date to see what is relevant now",
  "Choose which child to show timing for",
  "Choose girl or boy, or leave it blank",
  "Enter a birth weight between 100 g and 10 kg",
  "Enter a birth length between 15 and 80 cm",
  "Enter weeks at birth between 20 and 45",
  "Choose nursing, bottle or both, or leave it blank",
  seriesLimit,
]);
export interface RecordFilters {
  kind?: Kind;
  kinds?: readonly Kind[];
  child_id?: string | null;
  include_general?: boolean;
  q?: string;
  collection_id?: string;
  topic?: string;
  uncategorized?: boolean;
  offset?: number;
  limit?: number;
  timing?: "now" | "upcoming";
  timing_child_id?: string;
  within_weeks?: number;
  /** Half-open, with an offset: from <= occurred_at < to. */
  occurred_from?: string;
  occurred_to?: string;
  /** Questions and notes linked to this event. */
  event_id?: string;
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly local = false,
    readonly reason?: "related_space"
  ) {
    super(message);
  }
}
/** The row isn't in the space this write named. `moved` says where it went, so the write can follow it. */
export class MovedError extends ApiError {
  constructor(readonly moved: Moved) {
    super("This entry moved. It’s being sent to where it lives now.", 409);
  }
}
/** Create family was refused because a phone signed in to this account hasn't updated. */
export class PhonesNotReady extends ApiError {
  constructor(readonly readiness: FamilyReadiness) {
    super("Update your other phones first. Nothing has moved.", 409);
  }
}
export function createBabyApi(
  base: string,
  getToken: () => Promise<string | null>,
  current: () => boolean,
  transport: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  /** The bootstrap this phone holds, saved or fresh, which sets the client level. */
  known: () => Pick<Bootstrap, "spaces" | "personal_space_id"> | undefined = () => undefined
) {
  let epoch = 0,
    knownGeneration: number | undefined;
  /** By space, so joining one takes nothing away and only that space's own change ends what's under way. */
  const knownGenerations = new Map<string, number>();
  const lease = () => epoch;
  const assertLease = (captured: number) => {
    if (captured !== epoch)
      throw new ApiError("This request belongs to an earlier Baby space and was stopped.", 410, true);
  };
  const check = () => {
    if (!current()) throw new ApiError("Your account changed. This request was stopped.", 409);
  };
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    fence?: Fence,
    idempotencyKey?: string
  ): Promise<T> {
    check();
    const captured = epoch,
      generation = typeof fence === "object" ? fence.generation : fence,
      held = known(),
      live = spacesLive(held),
      // A bootstrap names no space. A route outside Baby has none.
      space = live && method !== "GET" && path !== "/bootstrap" && !path.startsWith("/api/")
        ? (typeof fence === "object" && fence.space_id) || held?.personal_space_id : undefined;
    if (!base) throw new ApiError("This build needs its Håfa service configuration.", 0);
    let token: string | null;
    try {
      token = await getToken();
    } catch {
      check();
      assertLease(captured);
      throw new ApiError("Couldn’t check your sign-in. Reconnect and try again, or sign in again.", 401);
    }
    check();
    assertLease(captured);
    if (!token) throw new ApiError("Sign in again to continue.", 401);
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), body instanceof FormData ? 90000 : 45000);
    try {
      const response = await transport(
        `${base.replace(/\/$/, "")}${path.startsWith("/api/") ? path : "/api/v1/baby" + path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
            // Bootstrap asks as 3 to hear what's on. A credential asks as 3 so this build is never counted as an old phone: the API treats a client below 3 asking as one, and takes back its readiness.
            "X-Baby-Client": String(live || path === "/bootstrap" || path === "/share/session" ? familyClient : babyClient),
            ...(space ? { "X-Baby-Space": space } : {}),
            ...(generation === undefined ? {} : { "X-Baby-Generation": String(generation) }),
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          },
          ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
          signal: abort.signal,
        }
      );
      check();
      assertLease(captured);
      if (!response.ok) {
        // Only this exact server-owned code selects a fixed local message.
        // Never reflect arbitrary backend/provider detail into private screens.
        let dailyLimit = false, relatedSpace = false,
          known = "";
        if (response.status === 422) {
          try {
            const error = await response.json();
            check();
            assertLease(captured);
            relatedSpace = error?.detail === "Related items must be in the same Baby space";
            known = knownDetails.has(error?.detail) ? error.detail : "";
          } catch (failure) {
            if (failure instanceof ApiError) throw failure;
          }
        }
        if (response.status === 429) {
          try {
            const error = await response.json();
            check();
            assertLease(captured);
            dailyLimit = error?.detail?.code === "baby_ai_daily_limit";
          } catch (failure) {
            if (failure instanceof ApiError) throw failure;
          }
        }
        if (response.status === 409) {
          let detail: { code?: string; phones?: FamilyReadiness["phones"]; older_client_at?: string | null } & Partial<Moved> = {};
          try {
            // A move comes back as the body itself. Any other coded refusal is under `detail`.
            const body = await response.json();
            detail = body?.code ? body : body?.detail ?? {};
            check();
            assertLease(captured);
          } catch (failure) {
            if (failure instanceof ApiError) throw failure;
          }
          if (detail.code === "moved" && detail.space_id && detail.generation !== undefined && detail.record)
            throw new MovedError({ space_id: detail.space_id, generation: detail.generation, revision: detail.revision ?? null, record: detail.record });
          if (detail.code === "phones_not_ready") throw new PhonesNotReady({ ready: false, phones: detail.phones ?? [], older_client_at: detail.older_client_at });
          if (detail.code === "family_exit_required") throw new ApiError("Leave your family first. Your family’s data isn’t erased from here.", 409);
        }
        const safe =
          response.status === 409
            ? "This record or account changed elsewhere. Your local version is safe. Review it before saving again."
            : response.status === 410
              ? "Your Baby data was cleared. Older device drafts will not be uploaded."
              : response.status === 401
                ? "Your session expired. Sign in again."
                : response.status === 403
                  ? "This action is unavailable. Check your account and AI permission."
                  : response.status === 413
                    ? "This file is too large. Choose a smaller file."
                    : response.status === 422
                      ? known === seriesLimit ? seriesLimitMessage : known ? `${known}.` : "Some details need review. Check your entries and try again."
                      : response.status === 429
                        ? dailyLimit
                          ? dailyAiLimitMessage
                          : "Please wait a moment before trying again."
                        : response.status === 404
                          ? unavailableMessage
                          : response.status >= 500
                            ? path === "/attachments"
                              ? "Håfa Baby could not upload this attachment. It is safe on this phone. Retry the upload later."
                              : "Håfa Baby could not save this change. It is safe on this phone. Retry later."
                            : "Håfa Baby could not accept this change. Review its details before retrying.";
        throw new ApiError(safe, response.status, false, relatedSpace ? "related_space" : undefined);
      }
      if (response.status === 204) return undefined as T;
      const value = (await response.json()) as T;
      check();
      assertLease(captured);
      if (path === "/bootstrap" || path === "/enroll") {
        const answer = value as Bootstrap, generation = answer.generation, stale = new ApiError("An older account response was stopped.", 410, true);
        if (knownGeneration !== undefined && generation < knownGeneration) throw stale;
        let ended = generation !== knownGeneration;
        for (const { id, generation: now } of answer.spaces ?? []) {
          const before = knownGenerations.get(id);
          if (before !== undefined && now < before) throw stale;
          ended ||= before !== undefined && before !== now;
        }
        if (path === "/bootstrap") {
          ended ||= !![...knownGenerations.keys()].some((id) => !answer.spaces?.some((space) => space.id === id));
          knownGenerations.clear();
          for (const { id, generation: now } of answer.spaces ?? []) knownGenerations.set(id, now);
        }
        knownGeneration = generation;
        if (ended) epoch++;
      }
      return value;
    } catch (e) {
      check();
      if (e instanceof ApiError) throw e;
      throw new ApiError(
        "Could not connect. You’re offline. Your work is saved on this phone and can retry when you reconnect.",
        0
      );
    } finally {
      clearTimeout(timer);
    }
  }
  function query(values: Record<string, string | number | boolean | readonly string[] | undefined | null>) {
    return Object.entries(values)
      .flatMap(([key, value]) => (Array.isArray(value) ? value : [value])
        .filter((part) => part !== undefined && part !== null && part !== "")
        .map((part) => `${encodeURIComponent(key)}=${encodeURIComponent(String(part))}`))
      .join("&");
  }

  return {
    request,
    lease,
    assertLease,
    identity: () => request<{ id: string }>("/api/users/me/identity"),
    onboard: (installationId: string) => request<{ status: "created" | "existing"; app_user_id: string }>(
      "/api/auth/clerk-transition/onboard", "POST", { installation_id: installationId, intent: "create_account" }),
    bootstrap: () => request<Bootstrap>("/bootstrap", "POST", {}),
    enroll: (g: number) => {
      epoch++;
      return request<Bootstrap>("/enroll", "POST", {}, g);
    },
    profile: (change: ProfileChange, g: Fence) => request<Profile>("/profile", "PATCH", change, g),
    child: (value: Partial<Child>, g: Fence) =>
      request<Child>(
        value.revision !== undefined ? `/children/${value.id}` : "/children",
        value.revision !== undefined ? "PATCH" : "POST",
        Object.fromEntries(Object.entries(value).filter(([key]) => key !== "space_id" && key !== "generation" && (value.revision === undefined || key !== "id"))),
        g
      ),
    deleteChild: (child: Child, g: Fence) =>
      request<void>(`/children/${child.id}?revision=${child.revision}`, "DELETE", undefined, typeof g === "number" ? rowFence(child, g) : g),
    records: (filters: RecordFilters = {}) =>
      request<RecordPage>("/records?" + query({ ...filters })),
    search: (q: string, kind?: Kind, child_id?: string | null,
      filters: Pick<RecordFilters, "kinds" | "include_general" | "offset" | "limit" | "collection_id" | "topic" | "uncategorized"> = {}) =>
      request<RecordPage>("/search?" + query({ q, kind, child_id, limit: 100, ...filters })),
    record: (id: string) => request<BabyRecord>(`/records/${encodeURIComponent(id)}`),
    /** Totals and dots per calendar day, inclusive, on the profile's clock. No child means the logs that have none. */
    careSummary: (from: string, to: string, child_id?: string | null) =>
      request<{ days: CareDay[] }>("/care/summary?" + query({ from, to, child_id })),
    /** One range's totals, averages and days. Every Stats number comes from here. */
    careStats: (choice: StatsChoice, child_id?: string | null) => request<CareStats>("/care/stats?" + query({ ...choice, child_id })),
    /** Dated occurrences on these calendar days, inclusive. With a child: theirs and the whole family's. */
    events: (from: string, to: string, child_id?: string | null) =>
      request<{ items: EventOccurrence[]; complete: boolean }>("/events?" + query({ from, to, child_id })),
    /** Ends a repeat before this date and starts the next: both or neither. Sending it again gets the same answer. */
    splitEvent: (series: string, { revision, from_start, event: { id, kind, title, body, child_id, occurred_at, data } }: { revision: number; from_start: string; event: RecordWrite }, g: Fence) =>
      request<{ series: BabyRecord | null; event: BabyRecord }>(`/events/${encodeURIComponent(series)}/split`, "POST",
        { revision, from_start, event: { id, kind, title, body, child_id, occurred_at, data } }, g),
    save: (value: RecordWrite, g: Fence) => {
      const { id, kind, title, body, child_id, occurred_at, data, revision } = value;
      // A row read from the API says where it lives, and a write has to go there.
      if (typeof g === "number") g = rowFence(value as { generation?: number; space_id?: string }, g);
      // Repair optional links at the wire boundary, including durable outbox
      // retries created by earlier share capture code. Keep nonblank bytes intact
      // so an accepted create with a lost response keeps the same replay hash.
      const payloadData = kind === "source" && typeof data.url === "string" && !data.url.trim()
        ? { ...data, url: null }
        : data;
      // A feed's actions only ever change through feed-action. An edit from an older copy must not put them back.
      if (revision && kind === "feeding") {
        const { actions: _a, state: _s, end_at: _e, ...edit } = payloadData;
        return request<BabyRecord>(`/records/${id}`, "PATCH", { title, body, child_id, occurred_at, data: edit, revision }, g);
      }
      return request<BabyRecord>(
        revision ? `/records/${id}` : "/records",
        revision ? "PATCH" : "POST",
        revision
          ? { title, body, child_id, occurred_at, data: payloadData, revision }
          : { id, kind, title, body, child_id, occurred_at, data: payloadData },
        g
      );
    },
    feedAction: (recordId: string, value: FeedAction, g: Fence) =>
      request<BabyRecord>(`/records/${recordId}/feed-action`, "POST",
        { action_id: value.id, action: value.action, at: value.at, ...(value.side ? { side: value.side } : {}) }, g),
    sessionAction: (recordId: string, value: SessionAction, g: Fence) =>
      request<BabyRecord>(`/records/${recordId}/session-action`, "POST",
        { action_id: value.id, action: value.action, at: value.at, ...(value.target ? { target: value.target } : {}) }, g),
    /** Accept or dismiss suggested categories; each item reports its own result. */
    decideSuggestions: (items: { record_id: string; revision: number }[], g: Fence, action: "accept" | "dismiss" = "accept") =>
      request<SuggestionResult>("/suggested-categories", "POST", { action, items }, g),
    remove: (value: BabyRecord, g: Fence) =>
      request<void>(`/records/${value.id}?revision=${value.revision}`, "DELETE", undefined, typeof g === "number" ? rowFence(value, g) : g),
    import: (
      value: {
        id: string;
        automatic?: boolean; automatic_epoch?: number;
        url?: string;
        text?: string;
        record_id?: string;
        attachment_ids?: string[];
        child_id?: string | null;
        topics?: string[];
      },
      g: Fence
    ) => request<ImportJob>("/imports", "POST", value, g),
    job: (id: string) => request<ImportJob>(`/imports/${id}`),
    retryJob: (id: string, g: Fence) => request<ImportJob>(`/imports/${id}/retry`, "POST", {}, g),
    cancelJob: (id: string, g: Fence) => request<ImportJob>(`/imports/${id}/cancel`, "POST", {}, g),
    upload: (body: FormData, g: Fence, id: string) => request<Attachment>("/attachments", "POST", body, g, id),
    attachment: (id: string) => request<Attachment>(`/attachments/${encodeURIComponent(id)}/metadata`),
    releaseAttachment: (id: string, g: Fence) =>
      request<void>(`/attachments/${encodeURIComponent(id)}/release`, "POST", {}, g),
    /** A file comes by its own download, not `request`, and the API needs the same client level to find a family's. */
    fileHeaders: () => ({ "X-Baby-Client": String(spacesLive(known()) ? familyClient : babyClient) }),
    attachmentUrl: (id: string) => `${base.replace(/\/$/, "")}/api/v1/baby/attachments/${id}`,
    chat: (
      body: {
        conversation_id?: string;
        request_id?: string;
        message: string;
        scope?: Scope;
        record_id?: string;
        child_id?: string | null;
        ask_v2?: boolean;
        focus_date?: string;
      },
      g: number
    ) => request<ChatResult>("/chat", "POST", body, g),
    conversations: () => request<{ items: Conversation[] }>("/conversations"),
    conversation: (id: string) => request<Conversation>(`/conversations/${id}`),
    /** What's changed in each space since these cursors. A bigger access version than the last means start again. */
    changes: (cursor: Record<string, number>, access: Record<string, number>) =>
      request<ChangesAnswer>("/changes?" + query({ cursor: JSON.stringify(cursor), access_version: JSON.stringify(access) })),
    /** A phone's push token, under the personal space's generation. What comes back is what its sign-out sends. */
    registerPushDevice: (installation: string, token: string, platform: "ios" | "android", generation: number) =>
      request<{ registration: string }>(`/push/devices/${encodeURIComponent(installation)}`, "PUT", { token, platform }, generation),
    unregisterPushDevice: (installation: string, registration: string) =>
      request<void>(`/push/devices/${encodeURIComponent(installation)}?` + query({ registration }), "DELETE"),
    dueReminders: () => request<{ items: DueReminder[] }>("/reminders/due"),
    upcomingReminders: () => request<{ items: UpcomingReminder[] }>("/reminders/upcoming"),
    dismissReminder: (id: string) => request<void>(`/reminders/${encodeURIComponent(id)}/dismiss`, "POST", {}),
    tappedReminder: (id: string) => request<TappedReminder>(`/reminders/${encodeURIComponent(id)}/tap`),
    pushPrefs: () => request<ReminderPrefs>("/push/prefs"),
    savePushPrefs: (patch: PrefsPatch, g: Fence) => request<ReminderPrefs>("/push/prefs", "PATCH", patch, g),
    /** What this phone has scheduled for itself, replacing what it said before. */
    reportRoutines: (installation: string, holds: Record<string, string>) =>
      request<{ held: number }>(`/push/devices/${encodeURIComponent(installation)}/routines`, "PUT", { holds }),
    readiness: (installation_id?: string) => request<FamilyReadiness>("/family/readiness?" + query({ installation_id })),
    /** She says the older phone is updated or gone. This phone's own credential stays. */
    confirmPhones: (installation_id?: string) => request<unknown>("/family/phones/confirm", "POST", installation_id ? { installation_id } : {}),
    /** The first one creates the family, and only with `publish` set: she's seen what becomes shared. */
    createInvite: (role: "parent" | "caregiver", publish: boolean, g: Fence) =>
      request<FamilyInvite>("/family/invites", "POST", { role, publish_shared: publish, disclosure_version: disclosureVersion }, g),
    previewInvite: (code: string) => request<InvitePreview>("/family/invites/preview", "POST", { code }),
    acceptInvite: (code: string, g: Fence) =>
      request<{ space_id: string; generation: number; role: string; access_version: number }>("/family/invites/accept", "POST", { code, disclosure_version: disclosureVersion }, g),
    familyMembers: (space: string) => request<{ items: FamilyMember[] }>(`/family/${encodeURIComponent(space)}/members`),
    familyInvites: (space: string) => request<{ items: FamilyInvite[] }>(`/family/${encodeURIComponent(space)}/invites`),
    revokeInvite: (space: string, id: string, g: Fence) => request<unknown>(`/family/${encodeURIComponent(space)}/invites/${encodeURIComponent(id)}`, "DELETE", undefined, g),
    removeMember: (space: string, actor: string, g: Fence) => request<unknown>(`/family/${encodeURIComponent(space)}/members/${encodeURIComponent(actor)}`, "DELETE", undefined, g),
    leaveFamily: (space: string, g: Fence) => request<unknown>(`/family/${encodeURIComponent(space)}/leave`, "POST", {}, g),
    deleteFamily: (space: string, g: Fence) => request<unknown>(`/family/${encodeURIComponent(space)}`, "DELETE", undefined, g),
    /** Shared with family or Just me. The row goes to `destination`, and the fence is where it lives now. */
    moveRecord: (row: BabyRecord, destination: string, g: Fence) =>
      request<BabyRecord>(`/records/${encodeURIComponent(row.id)}/move`, "POST", { space_id: destination, revision: row.revision }, g),
    renameConversation: (id: string, title: string, g: Fence) =>
      request<Conversation>(`/conversations/${encodeURIComponent(id)}`, "PATCH", { title }, g),
    deleteConversation: (id: string, g: Fence) =>
      request<void>(`/conversations/${encodeURIComponent(id)}`, "DELETE", undefined, g),
    export: () => request<unknown>("/export"),
    erase: (g: number) => {
      epoch++;
      return request<unknown>(`/data?generation=${g}`, "DELETE", undefined, g);
    },
    deleteAccount: () => request<unknown>("/api/users/me", "DELETE"),
  };
}
export type BabyApi = ReturnType<typeof createBabyApi>;
