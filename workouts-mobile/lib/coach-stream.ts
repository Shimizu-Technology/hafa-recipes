import type { CoachFocus, CoachMessage, CoachSummary } from "./coach";

type ExpoFetch = typeof import("expo/fetch")["fetch"];
const unavailable = () => Error("Could not confirm this reply. Check or retry the same saved request.");
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Reconstruct a canonical receipt; provisional text can never supply action routes. */
function receipt(value: unknown, requestId: string, generation: number): CoachMessage {
  if (!record(value) || value.request_id !== requestId || value.generation !== generation ||
      typeof value.id !== "string" || !["pending", "completed", "failed"].includes(String(value.state)) ||
      typeof value.user_message !== "string" || value.user_message.length > 4000 ||
      !(value.assistant_message === null || typeof value.assistant_message === "string" && value.assistant_message.length <= 16000) ||
      !Array.isArray(value.actions) || value.actions.length > 8 || typeof value.created_at !== "string" ||
      !Number.isFinite(Date.parse(value.created_at)) || !record(value.focus)) throw unavailable();
  const focus: CoachFocus = {};
  for (const key of ["context_workout_id", "context_program_id", "context_session_id"] as const) {
    if (value.focus[key] != null) {
      if (typeof value.focus[key] !== "string" || value.focus[key].length > 100) throw unavailable();
      focus[key] = value.focus[key];
    }
  }
  if (value.focus.context_revision != null) {
    if (!Number.isSafeInteger(value.focus.context_revision) || Number(value.focus.context_revision) < 1) throw unavailable();
    focus.context_revision = Number(value.focus.context_revision);
  }
  const actions: CoachSummary[] = value.actions.map(item => {
    if (!record(item) || typeof item.proposal_id !== "string" || !/^[0-9a-f-]{36}$/i.test(item.proposal_id) ||
        !["program", "adaptation", "profile", "schedule", "progression"].includes(String(item.kind)) ||
        !["proposed", "accepted", "undone"].includes(String(item.state)) || typeof item.status !== "string" || item.status.length > 100)
      throw unavailable();
    return { proposal_id: item.proposal_id, kind: item.kind as CoachSummary["kind"], state: item.state as CoachSummary["state"], status: item.status,
      ...(typeof item.record_id === "string" ? { record_id: item.record_id } : {}),
      ...(Number.isSafeInteger(item.after_revision) ? { after_revision: Number(item.after_revision) } : {}) };
  });
  if (value.state !== "completed" && actions.length) throw unavailable();
  if (value.state === "pending" && value.assistant_message) throw unavailable();
  if (value.cancelled != null && typeof value.cancelled !== "boolean") throw unavailable();
  return { id: value.id, request_id: requestId, generation, state: value.state as CoachMessage["state"],
    user_message: value.user_message, assistant_message: value.assistant_message as string | null, actions,
    created_at: value.created_at, focus, ...(value.cancelled === true ? { cancelled: true } : {}) };
}

/** Bounded native/web NDJSON. No JSON fallback or fresh UUID after uncertain delivery. */
export async function streamCoachRequest(options: {
  url: string; headers: Record<string, string>; body: { request_id: string; message: string } & CoachFocus;
  generation: number; signal?: AbortSignal; current(): void; onText(text: string): Promise<void> | void;
  fetchImpl?: ExpoFetch;
}): Promise<CoachMessage> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, 120000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const current = () => { options.current(); if (controller.signal.aborted) throw unavailable(); };
  try {
    current();
    const requestFetch = options.fetchImpl ?? (await import("expo/fetch")).fetch;
    const response = await requestFetch(options.url, { method: "POST", headers: { ...options.headers,
      "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify(options.body), signal: controller.signal });
    current();
    if (!response.ok) throw Object.assign(unavailable(), { status: response.status });
    if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("application/x-ndjson") || !response.body?.getReader) throw unavailable();
    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "", text = "", turn = 0, bytes = 0, frames = 0;
    let final: CoachMessage | undefined;
    const consume = async (line: string) => {
      if (!line.trim()) return;
      current();
      if (final || ++frames > 4096 || line.length > 65536) throw unavailable();
      let event: unknown;
      try { event = JSON.parse(line); } catch { throw unavailable(); }
      if (!record(event) || event.request_id !== options.body.request_id || event.generation !== options.generation) throw unavailable();
      if (event.type === "reset") {
        if (event.turn !== turn + 1 || Number(event.turn) > 2) throw unavailable();
        turn = Number(event.turn); text = ""; await options.onText("");
      } else if (event.type === "delta") {
        if (!turn || typeof event.text !== "string" || !event.text || text.length + event.text.length > 16000) throw unavailable();
        text += event.text; await options.onText(text);
      } else if (event.type === "receipt") final = receipt(event.receipt, options.body.request_id, options.generation);
      else if (event.type === "error") throw Object.assign(unavailable(), { status: Number.isInteger(event.status) ? event.status : 503 });
      else throw unavailable();
      current();
    };
    while (!final) {
      current();
      const next = await reader.read();
      current();
      if (next.value) {
        bytes += next.value.byteLength;
        if (bytes > 262144) throw unavailable();
        buffer += decoder.decode(next.value, { stream: true });
      }
      if (next.done) buffer += decoder.decode();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); await consume(line);
      }
      if (buffer.length > 65536) throw unavailable();
      if (next.done) { if (buffer.trim()) await consume(buffer); break; }
      if (final && buffer.trim()) throw unavailable();
    }
    if (!final) throw unavailable();
    current();
    return final;
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", abort); controller.abort();
    if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
}
