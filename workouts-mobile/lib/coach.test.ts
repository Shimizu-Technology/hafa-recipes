vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
import { it, expect, vi } from "vitest";
import { canAcceptCoach, coachFocusErrors, needsReturnConfirmation, type CoachAction } from "./coach";
import { createWorkoutsApi } from "./api";
const action = {
  id: "proposal",
  kind: "schedule",
  proposal: { status: "ready", operation: "return", confirmation_required: true },
  profile_revision: 7,
  target_id: "program",
  target_revision: 3,
  expires_at: "2027-01-01T00:00:00Z",
} as CoachAction;
it("requires an explicit comfortable-baseline confirmation for a reviewed return and refuses expired/not-ready actions", () => {
  expect(needsReturnConfirmation(action)).toBe(true);
  expect(canAcceptCoach(action, true, false, 0)).toBe(false);
  expect(canAcceptCoach(action, true, true, 0)).toBe(true);
  expect(
    canAcceptCoach({ ...action, proposal: { ...action.proposal, status: "needs_information" } }, true, true, 0)
  ).toBe(false);
  expect(canAcceptCoach(action, true, true, Date.parse("2028-01-01"))).toBe(false);
});
it("does not mix focus IDs or attach a revision to a session/general conversation", () => {
  expect(coachFocusErrors({ context_workout_id: "workout", context_program_id: "program" })).toHaveLength(1);
  expect(coachFocusErrors({ context_session_id: "actual", context_revision: 1 })).toHaveLength(1);
  expect(coachFocusErrors({ context_workout_id: "workout", context_revision: 3 })).toEqual([]);
  expect(coachFocusErrors({})).toEqual([]);
});
it("replays the identical message identity/focus/original generation after an uncertain response", async () => {
  const transport = vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce(new Response("{}"));
  const api = createWorkoutsApi("https://example.test", async () => "token", transport);
  const focus = { context_program_id: "program", context_revision: 3 };
  await expect(api.coachMessage("request", "Help me return", focus, 2)).rejects.toThrow();
  await api.coachMessage("request", "Help me return", focus, 2);
  expect(transport.mock.calls[0][1].body).toBe(transport.mock.calls[1][1].body);
  expect(transport.mock.calls[1][1].headers["X-Workouts-Generation"]).toBe("2");
  expect(JSON.parse(transport.mock.calls[1][1].body).context_revision).toBe(3);
});
it("return acceptance uses the coach receipt endpoint and only sends the strict confirmation when explicitly true", async () => {
  const transport = vi.fn().mockImplementation(async () => new Response("{}"));
  const api = createWorkoutsApi("https://example.test", async () => "token", transport);
  await api.acceptCoachAction("proposal", "My return", true, 2);
  await api.acceptCoachAction("different", "My plan", false, 2);
  expect(transport.mock.calls[0][0]).toContain("/coach/actions/proposal/accept");
  expect(JSON.parse(transport.mock.calls[0][1].body).confirm_return_baseline).toBe(true);
  expect(JSON.parse(transport.mock.calls[1][1].body)).not.toHaveProperty("confirm_return_baseline");
});
it("reads paused queue metadata outside proposal.sessions and never forwards it into a generic proposal update", async () => {
  const row = {
    id: "program",
    generation: 2,
    revision: 3,
    content: {
      title: "Paused plan",
      proposal: {
        status: "ready",
        sessions: [],
        questions: [],
        warnings: [],
        assumptions: [],
        source_ids: [],
        rule_version: "rules",
      },
      schedule_state: { status: "paused", paused_sessions: [{ id: "future", date: "2026-11-01" }] },
    },
  };
  const transport = vi.fn().mockImplementation(async () => new Response(JSON.stringify(row)));
  const api = createWorkoutsApi("https://example.test", async () => "token", transport);
  const program = await api.program("program");
  expect(program.schedule_state?.paused_sessions?.[0].id).toBe("future");
  await api.updateProgram(program);
  expect(JSON.parse(transport.mock.calls[1][1].body).proposal).not.toHaveProperty("schedule_state");
});
it("cancels the exact request using its original generation and an ordinary authenticated route", async () => {
  const receipt = { request_id: "original/request", state: "failed", cancelled: true };
  const transport = vi.fn().mockImplementation(async () => new Response(JSON.stringify(receipt)));
  const api = createWorkoutsApi("https://example.test", async () => "token", transport);
  expect(await api.cancelCoachMessage("original/request", 7)).toEqual(receipt);
  expect(transport.mock.calls[0][0]).toContain("/coach/messages/original%2Frequest/cancel");
  expect(transport.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { "X-Workouts-Generation": "7" } });
  expect(transport.mock.calls[0][1].body).toBeUndefined();
});

// Reuse the existing coach test suite for native/web transport, without a second harness.
import { streamCoachRequest } from "./coach-stream";
const wireId = "00000000-0000-4000-8000-000000000001";
const wireReceipt = { id: wireId, request_id: wireId, generation: 1, state: "completed", user_message: "Question",
  assistant_message: "Canonical answer", actions: [], created_at: "2026-10-16T00:00:00Z", focus: {} };
const frame = (event: Record<string, unknown>) => JSON.stringify({ request_id: wireId, generation: 1, ...event }) + "\n";
function streamingTransport(chunks: Uint8Array[]) {
  const source = new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
  return vi.fn().mockResolvedValue(new Response(source, { headers: { "Content-Type": "application/x-ndjson" } }));
}
const runStream = (fetchImpl: ReturnType<typeof streamingTransport>, onText = vi.fn()) => streamCoachRequest({
  url: "https://example.test/api/v1/workouts/coach/messages/stream", headers: { Authorization: "Bearer test", "X-Workouts-Generation": "1" },
  body: { request_id: wireId, message: "Question" }, generation: 1, current: () => undefined, onText,
  fetchImpl: fetchImpl as unknown as NonNullable<Parameters<typeof streamCoachRequest>[0]["fetchImpl"]>,
});
it("incrementally decodes fragmented Unicode, resets provisional turns and returns only the canonical receipt", async () => {
  const text = frame({ type: "reset", turn: 1 }) + frame({ type: "delta", text: "Preview 🏋️" }) + frame({ type: "reset", turn: 2 }) +
    frame({ type: "delta", text: "Second preview" }) + frame({ type: "receipt", receipt: wireReceipt });
  const bytes = new TextEncoder().encode(text), chunks = Array.from(bytes, value => new Uint8Array([value]));
  const onText = vi.fn(); const transport = streamingTransport(chunks);
  expect(await runStream(transport, onText)).toEqual(wireReceipt);
  expect(onText.mock.calls.map(([value]) => value)).toEqual(["", "Preview 🏋️", "", "Second preview"]);
  expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual({ request_id: wireId, message: "Question" });
});
it.each([
  frame({ type: "delta", text: "No reset" }),
  frame({ type: "reset", turn: 2 }),
  frame({ type: "reset", turn: 1 }) + frame({ type: "delta", text: "x".repeat(16001) }),
  frame({ type: "receipt", receipt: { ...wireReceipt, generation: 2 } }),
  frame({ type: "receipt", receipt: { ...wireReceipt, state: "pending", actions: [{ proposal_id: wireId }] } }),
  frame({ type: "tool", arguments: "PRIVATE TOOL" }),
  frame({ type: "receipt", receipt: wireReceipt }) + frame({ type: "delta", text: "Late" }),
  "PRIVATE MALFORMED JSON\n",
  "x".repeat(65537),
  frame({ type: "reset", turn: 1 }) + frame({ type: "delta", text: "Incomplete" }),
])("rejects malformed, oversized, mismatched or unterminated streams without exposing raw data", async text => {
  await expect(runStream(streamingTransport([new TextEncoder().encode(text)]))).rejects.toThrow("Could not confirm");
});
it("rechecks account authority before every delivered frame and stops reading after retirement", async () => {
  let current = true;
  const transport = streamingTransport([new TextEncoder().encode(frame({ type: "reset", turn: 1 }) + frame({ type: "delta", text: "Allowed" }) + frame({ type: "receipt", receipt: wireReceipt }))]);
  await expect(streamCoachRequest({ url: "https://example.test", headers: {}, body: { request_id: wireId, message: "Question" }, generation: 1,
    current: () => { if (!current) throw Error("Retired account"); }, onText: () => { current = false; },
    fetchImpl: transport as unknown as NonNullable<Parameters<typeof streamCoachRequest>[0]["fetchImpl"]> })).rejects.toThrow("Retired account");
});

it("uses native Expo streaming with the original authenticated account generation and frozen request body", async () => {
  const { fetch: nativeFetch } = await import("expo/fetch");
  const transport = streamingTransport([new TextEncoder().encode(frame({ type: "receipt", receipt: wireReceipt }))]);
  vi.mocked(nativeFetch).mockImplementation(transport as unknown as typeof nativeFetch);
  let binding = "current";
  const api = createWorkoutsApi("https://example.test/", async () => "account-token", vi.fn(),
    { owner: "stable-owner", binding, currentBinding: () => binding });
  expect(await api.coachStream(wireId, "Question", {}, 1, new AbortController().signal, () => undefined)).toEqual(wireReceipt);
  expect(transport.mock.calls[0][0]).toBe("https://example.test/api/v1/workouts/coach/messages/stream");
  expect(transport.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer account-token", "X-Hafa-Account-ID": "stable-owner", "X-Workouts-Generation": "1" });
  binding = "retired";
  await expect(api.coachStream(wireId, "Question", {}, 1, new AbortController().signal, () => undefined)).rejects.toThrow("changed");
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each([
  { cancelled: true, text: "Reply stopped. No training changes were applied." },
  { cancelled: false, text: "I couldn't finish this request. Review your current training information and send a new message to retry." },
  { cancelled: false, text: "This request timed out. Send a new message to retry." },
])("accepts bounded canonical failed/stopped guidance as a terminal replay receipt: $text", async ({ cancelled, text }) => {
  const failed = { ...wireReceipt, state: "failed", assistant_message: text, ...(cancelled ? { cancelled: true } : {}) };
  const onText = vi.fn();
  expect(await runStream(streamingTransport([new TextEncoder().encode(frame({ type: "receipt", receipt: failed }))]), onText)).toEqual(failed);
  expect(onText).not.toHaveBeenCalled();
});
it.each([
  { ...wireReceipt, state: "pending", assistant_message: "Not a terminal answer" },
  { ...wireReceipt, state: "failed", actions: [{ proposal_id: wireId, kind: "schedule", status: "ready", state: "proposed" }] },
  { ...wireReceipt, state: "failed", assistant_message: "x".repeat(16001) },
])("still rejects pending answers, noncompleted actions and oversized guidance", async failed => {
  await expect(runStream(streamingTransport([new TextEncoder().encode(frame({ type: "receipt", receipt: failed }))]))).rejects.toThrow("Could not confirm");
});


it("photo routes use original upload UUID privacy deletion and freeze only attachment ID into coach sends", async () => {
  const transport = vi.fn().mockImplementation(async (_url, init) => new Response(init.method === "DELETE" ? null : JSON.stringify({ id: "photo", expires_at: "2099-01-01T00:00:00Z" }),
    { status: init.method === "DELETE" ? 204 : 200, headers: { "Content-Type": "application/json" } }));
  const api = createWorkoutsApi("https://example.test", async () => "token", transport);
  await api.uploadCoachImage("original-upload", { base64_data: "photo-bytes", content_type: "image/jpeg" }, 2);
  await api.discardCoachImage("original-upload", 2);
  await api.removeCoachImage("attachment", 2);
  await api.coachMessage("request", "Question", {}, 2, undefined, "attachment");
  expect(transport.mock.calls.map(([url]) => url)).toEqual([
    "https://example.test/api/v1/workouts/coach/image-uploads/original-upload", "https://example.test/api/v1/workouts/coach/image-uploads/original-upload",
    "https://example.test/api/v1/workouts/coach/images/attachment", "https://example.test/api/v1/workouts/coach/messages"]);
  expect(transport.mock.calls.every(([, init]) => init.headers["X-Workouts-Generation"] === "2")).toBe(true);
  expect(JSON.parse(transport.mock.calls[3][1].body)).toEqual({ request_id: "request", message: "Question", attachment_id: "attachment" });
});

it("freezes stream attachment and focus before an asynchronous auth token lookup", async () => {
  const { fetch: nativeFetch } = await import("expo/fetch");
  const transport = streamingTransport([new TextEncoder().encode(frame({ type: "receipt", receipt: wireReceipt }))]);
  vi.mocked(nativeFetch).mockImplementation(transport as unknown as typeof nativeFetch);
  let token!: (value: string) => void; const api = createWorkoutsApi("https://example.test", () => new Promise(done => { token = done; }), vi.fn());
  const focus = { context_workout_id: "original-workout", context_revision: 3 }, attachment = "7098abe8-bd72-43cc-bcaf-9f5963fe32cb";
  const request = api.coachStream(wireId, "Question", focus, 1, new AbortController().signal, () => undefined, attachment);
  focus.context_workout_id = "changed-workout"; focus.context_revision = 9; token("token"); await request;
  expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual({ request_id: wireId, message: "Question", context_workout_id: "original-workout", context_revision: 3, attachment_id: attachment });
});
it.each(["completed", "failed"])("accepts only ID/expiry photo metadata on a canonical %s receipt", async state => {
  const metadata = { attachment_id: "7098abe8-bd72-43cc-bcaf-9f5963fe32cb", attachment_expires_at: "2026-10-17T00:00:00Z" };
  const photo = { ...wireReceipt, state, ...metadata, ...(state === "failed" ? { cancelled: true } : {}) };
  const result = await runStream(streamingTransport([new TextEncoder().encode(frame({ type: "receipt", receipt: { ...photo, signed_url: "https://private.test/raw", image_bytes: "raw" } }))]));
  expect(result).toEqual(photo); expect(result).not.toHaveProperty("signed_url"); expect(result).not.toHaveProperty("image_bytes");
});
it.each([
  { attachment_id: "7098abe8-bd72-43cc-bcaf-9f5963fe32cb" },
  { attachment_expires_at: "2026-10-17T00:00:00Z" },
  { attachment_id: "https://private.test/photo", attachment_expires_at: "2026-10-17T00:00:00Z" },
  { attachment_id: "7098abe8-bd72-43cc-bcaf-9f5963fe32cb", attachment_expires_at: "invalid" },
])("rejects malformed or partial photo metadata while preserving same-request recovery", async metadata => {
  await expect(runStream(streamingTransport([new TextEncoder().encode(frame({ type: "receipt", receipt: { ...wireReceipt, ...metadata } }))]))).rejects.toThrow("Could not confirm");
});
