import type {
  Attachment,
  Bootstrap,
  BabyRecord,
  ChatResult,
  Child,
  Conversation,
  ImportJob,
  Kind,
  Profile,
  RecordPage,
  RecordWrite,
  Scope,
} from "./models";
import { dailyAiLimitMessage } from "./import-status";
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
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly local = false
  ) {
    super(message);
  }
}
export function createBabyApi(
  base: string,
  getToken: () => Promise<string | null>,
  current: () => boolean,
  transport: (input: string, init?: RequestInit) => Promise<Response> = fetch
) {
  let epoch = 0,
    knownGeneration: number | undefined;
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
    generation?: number,
    idempotencyKey?: string
  ): Promise<T> {
    check();
    const captured = epoch;
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
        let dailyLimit = false;
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
                      ? "Some details need review. Check your entries and try again."
                      : response.status === 429
                        ? dailyLimit
                          ? dailyAiLimitMessage
                          : "Please wait a moment before trying again."
                        : response.status === 404
                          ? "This item is no longer available. Keep your local copy or discard this change."
                          : response.status >= 500
                            ? path === "/attachments"
                              ? "Håfa Baby could not upload this attachment. It is safe on this phone. Retry the upload later."
                              : "Håfa Baby could not save this change. It is safe on this phone. Retry later."
                            : "Håfa Baby could not accept this change. Review its details before retrying.";
        throw new ApiError(safe, response.status);
      }
      if (response.status === 204) return undefined as T;
      const value = (await response.json()) as T;
      check();
      assertLease(captured);
      if (path === "/bootstrap" || path === "/enroll") {
        const generation = (value as Bootstrap).generation;
        if (knownGeneration !== undefined && generation < knownGeneration)
          throw new ApiError("An older account response was stopped.", 410, true);
        if (generation !== knownGeneration) {
          knownGeneration = generation;
          epoch++;
        }
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
    profile: (value: Profile, g: number) => {
      const { auto_process_epoch: _, ...patch } = value;
      return request<Profile>("/profile", "PATCH", patch, g);
    },
    child: (value: Partial<Child>, g: number) =>
      request<Child>(
        value.revision !== undefined ? `/children/${value.id}` : "/children",
        value.revision !== undefined ? "PATCH" : "POST",
        value.revision !== undefined
          ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "id"))
          : value,
        g
      ),
    deleteChild: (child: Child, g: number) =>
      request<void>(`/children/${child.id}?revision=${child.revision}`, "DELETE", undefined, g),
    records: (filters: RecordFilters = {}) =>
      request<RecordPage>("/records?" + query({ ...filters })),
    search: (q: string, kind?: Kind, child_id?: string | null,
      filters: Pick<RecordFilters, "kinds" | "include_general" | "offset" | "limit" | "collection_id" | "topic" | "uncategorized"> = {}) =>
      request<RecordPage>("/search?" + query({ q, kind, child_id, limit: 100, ...filters })),
    record: (id: string) => request<BabyRecord>(`/records/${encodeURIComponent(id)}`),
    save: (value: RecordWrite, g: number) => {
      const { id, kind, title, body, child_id, occurred_at, data, revision } = value;
      // Repair optional links at the wire boundary, including durable outbox
      // retries created by earlier share capture code. Keep nonblank bytes intact
      // so an accepted create with a lost response keeps the same replay hash.
      const payloadData = kind === "source" && typeof data.url === "string" && !data.url.trim()
        ? { ...data, url: null }
        : data;
      return request<BabyRecord>(
        revision ? `/records/${id}` : "/records",
        revision ? "PATCH" : "POST",
        revision
          ? { title, body, child_id, occurred_at, data: payloadData, revision }
          : { id, kind, title, body, child_id, occurred_at, data: payloadData },
        g
      );
    },
    remove: (value: BabyRecord, g: number) =>
      request<void>(`/records/${value.id}?revision=${value.revision}`, "DELETE", undefined, g),
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
      g: number
    ) => request<ImportJob>("/imports", "POST", value, g),
    job: (id: string) => request<ImportJob>(`/imports/${id}`),
    retryJob: (id: string, g: number) => request<ImportJob>(`/imports/${id}/retry`, "POST", {}, g),
    cancelJob: (id: string, g: number) => request<ImportJob>(`/imports/${id}/cancel`, "POST", {}, g),
    upload: (body: FormData, g: number, id: string) => request<Attachment>("/attachments", "POST", body, g, id),
    attachment: (id: string) => request<Attachment>(`/attachments/${encodeURIComponent(id)}/metadata`),
    releaseAttachment: (id: string, g: number) =>
      request<void>(`/attachments/${encodeURIComponent(id)}/release`, "POST", {}, g),
    attachmentUrl: (id: string) => `${base.replace(/\/$/, "")}/api/v1/baby/attachments/${id}`,
    chat: (
      body: {
        conversation_id?: string;
        request_id?: string;
        message: string;
        scope?: Scope;
        record_id?: string;
        child_id?: string | null;
      },
      g: number
    ) => request<ChatResult>("/chat", "POST", body, g),
    conversations: () => request<{ items: Conversation[] }>("/conversations"),
    conversation: (id: string) => request<Conversation>(`/conversations/${id}`),
    export: () => request<unknown>("/export"),
    erase: (g: number) => {
      epoch++;
      return request<unknown>(`/data?generation=${g}`, "DELETE", undefined, g);
    },
    deleteAccount: () => request<unknown>("/api/users/me", "DELETE"),
  };
}
export type BabyApi = ReturnType<typeof createBabyApi>;
