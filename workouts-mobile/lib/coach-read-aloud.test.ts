import { afterEach, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createElement, useEffect } from "react";
import { createCoachReadAloud, readAloudText, speechChunks, type DeviceSpeech } from "./coach-read-aloud";
import type { CoachMessage } from "./coach";
const native = vi.hoisted(() => ({ speak: vi.fn(), stop: vi.fn(async () => undefined), quiet: vi.fn(async () => false), voices: vi.fn(async () => [{ identifier: "local" }]),
  state: "active", listeners: new Set<(state: string) => void>() }));
vi.mock("expo-speech", () => ({ speak: native.speak, stop: native.stop, isSpeakingAsync: native.quiet, getAvailableVoicesAsync: native.voices, maxSpeechInputLength: 4000 }));
vi.mock("react-native", () => ({ View: "View", Platform: { OS: "ios" }, AppState: {
  get currentState() { return native.state; }, addEventListener: (_: string, listener: (state: string) => void) => {
    native.listeners.add(listener); return { remove: () => native.listeners.delete(listener) };
  },
} }));
vi.mock("expo-router", () => ({ router: { push: vi.fn(), replace: vi.fn() }, useLocalSearchParams: () => ({}),
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]) }));
import { stopCoachReadAloud, useCoachReadAloud } from "./use-coach-read-aloud";
const message = (id = "reply"): CoachMessage => ({ id, request_id: id, generation: 1, state: "completed", user_message: "Question",
  assistant_message: "## Try **three** sets of [squats](https://example.test/private).", actions: [], created_at: "2026-10-16T00:00:00Z", focus: {} });
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
function fixture() {
  const speech = { speak: vi.fn(), stop: vi.fn(async () => undefined), isSpeakingAsync: vi.fn(async () => false), getAvailableVoicesAsync: vi.fn(async () => [{ identifier: "local" }]), maxSpeechInputLength: 4000 };
  const control = createCoachReadAloud(speech);
  const scope = {};
  const read = (id = "reply", current = () => true) => control.begin({ scope, current, message: message(id) });
  return { speech, control, scope, read };
}
it("normalizes bounded markdown without reading destinations, images or markup", () => {
  expect(readAloudText("# **Squats** [details](https://private.test) ![photo](https://photo.test)\n> 10 reps")).toBe("Squats details 10 reps");
  expect(readAloudText("x".repeat(16001))).toBe("");
  expect(readAloudText("word ".repeat(1000))).toBe("word ".repeat(1000).trim());
  expect(readAloudText("-10 kg change\n3*5 reps and sets_of_10")).toBe("-10 kg change 3 times 5 reps and sets of 10");
  expect(readAloudText("Keep RPE < 8 and rest > 60 seconds. <b>Easy</b>")).toBe("Keep RPE < 8 and rest > 60 seconds. Easy");
});
it.each([
  ["Do ```10 squats```; do not exceed 3 rounds.", "Do 10 squats ; do not exceed 3 rounds."],
  ["```10 squats```; do not exceed 3 rounds.", "10 squats ; do not exceed 3 rounds."],
  ["Do:\n```text\n10 squats; do not exceed 3 rounds.\n```\nThen rest 60 seconds.", "Do: 10 squats; do not exceed 3 rounds. Then rest 60 seconds."],
])("preserves inline fenced doses and following limits: %s", (markdown, expected) => {
  expect(readAloudText(markdown)).toBe(expected);
});
it("does not speak until explicit activation and accepts only completed current replies", async () => {
  const { speech, control, scope, read } = fixture();
  expect(speech.speak).not.toHaveBeenCalled();
  for (const state of ["pending", "failed"] as const) control.begin({ scope, current: () => true, message: { ...message(), state } });
  read("stale", () => false); await settle(); expect(speech.speak).not.toHaveBeenCalled();
  read(); await settle(); expect(speech.speak).toHaveBeenCalledOnce();
  expect(speech.speak.mock.calls[0][0]).toBe("Try three sets of squats.");
  expect(control.snapshot().phase).toBe("reading");
});
it("replaces one utterance and ignores its retired completion/error callbacks", async () => {
  const { speech, control, read } = fixture(); read("first"); await settle();
  const old = speech.speak.mock.calls[0][1];
  read("second"); await settle(); expect(speech.stop).toHaveBeenCalledTimes(2);
  old.onDone?.(); old.onError?.(Error("retired"));
  expect(control.snapshot().messageId).toBe("second");
  speech.speak.mock.calls[1][1].onDone?.(); expect(control.snapshot().phase).toBe("idle");
});
it("ignores an old screen’s scoped stop after a new screen starts reading", async () => {
  const { control, scope, read } = fixture(); read(); await settle(); await control.stop(scope);
  const next = {}; control.begin({ scope: next, current: () => true, message: message("new-screen") }); await settle();
  await control.stop(scope);
  expect(control.snapshot().messageId).toBe("new-screen"); expect(control.snapshot().phase).toBe("reading");
});
it("stops a pending voice lookup without ever starting its speech", async () => {
  const { speech, control, scope, read } = fixture();
  let resolve!: (voices: { identifier: string }[]) => void;
  speech.getAvailableVoicesAsync.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  read(); await settle(); const stopped = control.stop(scope);
  await stopped;
  resolve([{ identifier: "local" }]); await settle();
  expect(speech.speak).not.toHaveBeenCalled(); expect(control.snapshot().phase).toBe("idle"); expect(control.snapshot().error).toBe("");
});
it("bounds a stalled voice lookup and keeps retry available", async () => {
  vi.useFakeTimers();
  try {
    const { speech, control, read } = fixture();
    speech.getAvailableVoicesAsync.mockReturnValueOnce(new Promise(() => undefined));
    read(); await settle(); await vi.advanceTimersByTimeAsync(5000);
    expect(control.snapshot().phase).toBe("idle"); expect(control.snapshot().error).toContain("try again");
    read(); await settle(); expect(speech.speak).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});
it("does not publish a stale lookup failure into a replacement scope", async () => {
  const { speech, control, read } = fixture();
  let reject!: (error: Error) => void;
  speech.getAvailableVoicesAsync.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  let current = true; read("first", () => current); await settle(); current = false;
  reject(Error("retired")); await settle();
  expect(control.snapshot().phase).toBe("idle"); expect(control.snapshot().error).toBe("");
});
it("reports voice failure honestly and allows an explicit retry", async () => {
  const { speech, control, read } = fixture();
  speech.getAvailableVoicesAsync.mockRejectedValueOnce(Error("unavailable")); read(); await settle();
  expect(control.snapshot().error).toContain("try again"); expect(speech.speak).not.toHaveBeenCalled();
  read(); await settle(); expect(speech.speak).toHaveBeenCalledOnce(); expect(control.snapshot().error).toBe("");
});
it("retains uncertain Stop authority, blocks new speech and retries until native stop confirms", async () => {
  const { speech, control, scope, read } = fixture(); read(); await settle();
  const callbacks = speech.speak.mock.calls[0][1];
  speech.stop.mockRejectedValueOnce(Error("native stop failed"));
  const first = control.stop(scope), duplicate = control.stop(scope);
  expect(first).toBe(duplicate);
  await expect(first).rejects.toThrow("Couldn’t confirm speech stopped");
  expect(control.snapshot()).toMatchObject({ phase: "stop_failed", messageId: "reply" });
  callbacks.onError?.(Error("retired"));
  expect(control.snapshot().phase).toBe("stop_failed");
  read("blocked"); await settle(); expect(speech.speak).toHaveBeenCalledOnce();
  await control.stop(scope); expect(control.snapshot().phase).toBe("idle");
  read("retry"); await settle(); expect(control.snapshot().messageId).toBe("retry");
});
it("retains uncertain replacement-stop authority when A is speaking and B cannot stop it", async () => {
  const { speech, control, scope, read } = fixture(); read("A"); await settle();
  speech.stop.mockRejectedValueOnce(Error("replacement stop failed")); read("B"); await settle();
  expect(control.snapshot()).toMatchObject({ phase: "stop_failed", messageId: "B" });
  read("C"); await settle(); expect(speech.speak).toHaveBeenCalledOnce();
  speech.stop.mockRejectedValueOnce(Error("still uncertain")); await expect(control.stop(scope)).rejects.toThrow("confirm speech stopped");
  expect(control.snapshot().phase).toBe("stop_failed");
  await control.stop({}); expect(control.snapshot().phase).toBe("idle");
  read("B"); await settle(); expect(speech.speak).toHaveBeenCalledTimes(2);
});
it("permits a later scope cleanup to retry uncertain audio without interrupting a new reading lease", async () => {
  const { speech, control, scope, read } = fixture(); read(); await settle();
  speech.stop.mockRejectedValueOnce(Error("stop failed")); await expect(control.stop(scope)).rejects.toThrow();
  await control.stop({}); expect(control.snapshot().phase).toBe("idle");
  control.begin({ scope: {}, current: () => true, message: message("new") }); await settle();
  await control.stop(scope); expect(control.snapshot().messageId).toBe("new");
});
it("requires a local browser voice and never falls back to a remote voice", async () => {
  const speech: DeviceSpeech = { maxSpeechInputLength: 4000, speak: vi.fn(), stop: async () => undefined, isSpeakingAsync: async () => false,
    getAvailableVoicesAsync: async () => [{ identifier: "remote", localService: false }] };
  const control = createCoachReadAloud(speech, true); control.begin({ scope: {}, current: () => true, message: message() });
  await settle(); expect(speech.speak).not.toHaveBeenCalled(); expect(control.snapshot().error).toContain("speech voices");
});
let view: ReactTestRenderer | undefined;
afterEach(async () => { if (view) { await act(async () => view!.unmount()); view = undefined; } await stopCoachReadAloud().catch(() => undefined);
  native.speak.mockClear(); native.stop.mockReset(); native.stop.mockResolvedValue(undefined); native.quiet.mockReset(); native.quiet.mockResolvedValue(false); native.state = "active"; });
async function hookFixture() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let input = { owner: "owner", generation: 1, storage: { isCurrent: () => true }, focus: "workout:1", epoch: "one", enabled: true, isCurrentAccount: () => true };
  let result!: ReturnType<typeof useCoachReadAloud>;
  function Hook() { result = useCoachReadAloud(input); return null; }
  await act(async () => { view = create(createElement(Hook)); });
  return { get result() { return result; }, input, async update(patch: Partial<typeof input>) {
    input = { ...input, ...patch }; await act(async () => view!.update(createElement(Hook)));
  } };
}
it.each(["owner", "generation", "storage", "focus", "epoch", "enabled"] as const)("retires speech on committed %s changes", async field => {
  const hook = await hookFixture(); await act(async () => { hook.result.read(message()); await settle(); });
  expect(native.speak).toHaveBeenCalledOnce();
  const changes = { owner: "other", generation: 2, storage: { isCurrent: () => true }, focus: "workout:2", epoch: "two", enabled: false };
  await hook.update({ [field]: changes[field] }); await act(settle);
  expect(hook.result.messageId).toBeNull(); expect(native.stop.mock.calls.length).toBeGreaterThan(1);
});
it("rejects retired account/storage authority and mismatched reply generation before speech", async () => {
  const hook = await hookFixture();
  await act(async () => { hook.result.read({ ...message(), generation: 2 }); await settle(); });
  await hook.update({ isCurrentAccount: () => false });
  await act(async () => { hook.result.read(message()); await settle(); });
  await hook.update({ isCurrentAccount: () => true, storage: { isCurrent: () => false } });
  await act(async () => { hook.result.read(message()); await settle(); });
  expect(native.speak).not.toHaveBeenCalled();
});
it("stops on background and unmount, and exposes an awaited stop before microphone capture", async () => {
  const hook = await hookFixture(); await act(async () => { hook.result.read(message()); await settle(); });
  await act(async () => { native.state = "background"; native.listeners.forEach(listener => listener("background")); await settle(); });
  expect(hook.result.messageId).toBeNull();
  native.state = "active"; await hook.update({});
  await act(async () => { hook.result.read(message()); await settle(); await stopCoachReadAloud(); });
  expect(hook.result.messageId).toBeNull();
  await act(async () => { hook.result.read(message()); await settle(); });
  await act(async () => { view!.unmount(); view = undefined; await settle(); });
  expect(native.listeners.size).toBe(0);
});

it.each(["account", "storage"] as const)("stops a committed %s authority revocation even when identity objects stay the same", async kind => {
  const hook = await hookFixture(); let valid = true;
  const check = () => valid;
  await hook.update(kind === "account" ? { isCurrentAccount: check } : { storage: { isCurrent: check } });
  await act(async () => { hook.result.read(message()); await settle(); });
  const before = native.stop.mock.calls.length;
  native.stop.mockRejectedValueOnce(Error("uncertain stop")); valid = false;
  await hook.update({}); await act(settle);
  expect(hook.result.stopFailed).toBe(true);
  expect(native.stop.mock.calls.length).toBe(before + 1); // no automatic retry loop on rendered error
  await act(async () => { await hook.result.retryStop(); });
  expect(hook.result.messageId).toBeNull();
});
it("retains visible stop retry and blocks dictation after rejection, then retries on background and unmount", async () => {
  const hook = await hookFixture(); await act(async () => { hook.result.read(message()); await settle(); });
  native.stop.mockRejectedValueOnce(Error("native stop failed"));
  await act(async () => { await expect(stopCoachReadAloud()).rejects.toThrow("Couldn’t confirm speech stopped"); });
  expect(hook.result.stopFailed).toBe(true); expect(hook.result.messageId).toBe("reply");
  await act(async () => { hook.result.read(message("new")); await settle(); }); expect(native.speak).toHaveBeenCalledOnce();
  await act(async () => { native.state = "background"; native.listeners.forEach(listener => listener("background")); await settle(); });
  expect(hook.result.stopFailed).toBe(false); expect(hook.result.messageId).toBeNull();
  native.state = "active"; await hook.update({});
  await act(async () => { hook.result.read(message()); await settle(); });
  native.stop.mockRejectedValueOnce(Error("native stop failed"));
  await act(async () => { await expect(hook.result.stop()).rejects.toThrow(); });
  const stops = native.stop.mock.calls.length;
  await act(async () => { view!.unmount(); view = undefined; await settle(); });
  expect(native.stop.mock.calls.length).toBe(stops + 1);
});

it("reads the whole canonical reply in bounded UTF16-safe chunks, advancing only once per native completion", async () => {
  const { speech, control, scope } = fixture();
  speech.maxSpeechInputLength = 17;
  const canonical = "# " + "10 squats 🏋️ then -5 kg. ".repeat(260);
  const plain = readAloudText(canonical);
  const chunks = speechChunks(plain, speech.maxSpeechInputLength);
  expect(chunks.join("")).toBe(plain); expect(plain.length).toBeGreaterThan(4000);
  expect(chunks.every(chunk => chunk.length <= 17 && !/[\uD800-\uDBFF]$/.test(chunk) && !/^[\uDC00-\uDFFF]/.test(chunk))).toBe(true);
  control.begin({ scope, current: () => true, message: { ...message(), assistant_message: canonical } });
  await settle(); expect(speech.speak).toHaveBeenCalledOnce();
  const first = speech.speak.mock.calls[0][1]; first.onDone?.(); first.onDone?.();
  expect(speech.speak).toHaveBeenCalledTimes(2);
  for (let index = 1; index < chunks.length; index++) speech.speak.mock.calls[index][1].onDone?.();
  expect(speech.speak.mock.calls.map(call => call[0]).join("")).toBe(plain);
  expect(control.snapshot().phase).toBe("idle");
});
it.each(["stop", "authority", "error"])("retires unread chunks on %s without queued speech or stale callback advancement", async kind => {
  const { speech, control, scope } = fixture(); let current = true;
  control.begin({ scope, current: () => current, message: { ...message(), assistant_message: "word ".repeat(1000) } });
  await settle(); const prior = speech.speak.mock.calls[0][1];
  if (kind === "stop") await control.stop(scope);
  if (kind === "authority") current = false;
  if (kind === "error") prior.onError?.(Error("voice error"));
  prior.onDone?.(); expect(speech.speak).toHaveBeenCalledOnce();
  expect(control.snapshot().phase).toBe("idle");
});
it("retains uncertain Stop when the OS still speaks or cannot verify silence, blocking replacement until retry", async () => {
  const { speech, control, scope, read } = fixture(); read(); await settle();
  speech.isSpeakingAsync.mockResolvedValueOnce(true);
  await expect(control.stop(scope)).rejects.toThrow("confirm speech stopped");
  read("blocked"); await settle(); expect(speech.speak).toHaveBeenCalledOnce();
  speech.isSpeakingAsync.mockResolvedValueOnce(undefined as unknown as boolean);
  await expect(control.stop(scope)).rejects.toThrow("confirm speech stopped");
  speech.isSpeakingAsync.mockRejectedValueOnce(Error("OS unavailable"));
  await expect(control.stop(scope)).rejects.toThrow("confirm speech stopped");
  expect(control.snapshot().phase).toBe("stop_failed");
  await control.stop(scope); read("confirmed"); await settle();
  expect(control.snapshot().messageId).toBe("confirmed");
});
it("bounds a stalled native Stop and keeps its authority until a later confirmed retry", async () => {
  vi.useFakeTimers();
  try {
    const { speech, control, scope, read } = fixture(); read(); await settle();
    speech.stop.mockImplementationOnce(() => new Promise(() => undefined));
    const stopped = control.stop(scope); const rejected = expect(stopped).rejects.toThrow("confirm speech stopped");
    await settle(); await vi.advanceTimersByTimeAsync(5000); await rejected;
    expect(control.snapshot().phase).toBe("stop_failed");
    read("blocked"); await settle(); expect(speech.speak).toHaveBeenCalledOnce();
    await control.stop(scope); expect(control.snapshot().phase).toBe("idle");
  } finally { vi.useRealTimers(); }
});

it("reports a native failure starting a later chunk and never advances a stale callback", async () => {
  const { speech, control, scope } = fixture();
  control.begin({ scope, current: () => true, message: { ...message(), assistant_message: "word ".repeat(1000) } });
  await settle(); const first = speech.speak.mock.calls[0][1];
  speech.speak.mockImplementationOnce(() => { throw Error("native unavailable"); });
  expect(() => first.onDone?.()).not.toThrow();
  expect(control.snapshot()).toMatchObject({ phase: "idle" });
  expect(control.snapshot().error).toContain("try again");
  first.onDone?.(); expect(speech.speak).toHaveBeenCalledTimes(2);
});

it("retires a retained Retry Stop across owners while a new owner can stop uncertain speech even when disabled", async () => {
  const hook = await hookFixture(); await act(async () => { hook.result.read(message("A")); await settle(); });
  native.stop.mockRejectedValueOnce(Error("uncertain A"));
  await act(async () => { await expect(hook.result.stop()).rejects.toThrow(); });
  const retainedRetry = hook.result.retryStop;
  native.stop.mockRejectedValueOnce(Error("still uncertain during cleanup"));
  await hook.update({ owner: "B", enabled: false }); await act(settle);
  expect(hook.result.stopFailed).toBe(true);
  await act(async () => { await hook.result.retryStop(); });
  expect(hook.result.stopFailed).toBe(false);
  await hook.update({ enabled: true });
  await act(async () => { hook.result.read(message("B")); await settle(); });
  const stops = native.stop.mock.calls.length;
  await act(async () => { await retainedRetry(); await settle(); });
  expect(native.stop).toHaveBeenCalledTimes(stops); expect(hook.result.messageId).toBe("B");
  native.stop.mockRejectedValueOnce(Error("uncertain B"));
  await act(async () => { await expect(hook.result.stop()).rejects.toThrow(); });
  await act(async () => { await hook.result.retryStop(); }); expect(hook.result.stopFailed).toBe(false);
});
