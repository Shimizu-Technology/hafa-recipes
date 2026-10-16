import { expect, it, vi } from "vitest";
import { applyVoiceTranscript, createCoachVoice, voiceGuidance, type Recognition } from "./coach-voice";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(permission = Promise.resolve(true)) {
  let events!: Parameters<Recognition["listen"]>[0];
  const remove = vi.fn();
  const native = { available: vi.fn(() => true), permission: vi.fn(() => permission),
    listen: vi.fn((handlers: typeof events) => { events = handlers; return remove; }),
    start: vi.fn(), stop: vi.fn(), abort: vi.fn() };
  const manager = createCoachVoice(native);
  const write = vi.fn(); let current = true;
  const capture = { scope: "owner:1:focus:consent", base: "Keep my question", current: () => current, write };
  return { native, manager, capture, write, remove, events: () => events, retire: () => { current = false; } };
}
it("replaces interim hypotheses rather than appending them, with a 4,000 character cap", async () => {
  const f = fixture(); await f.manager.begin(f.capture);
  f.events().result("add a row"); f.events().result("add a row on Monday");
  expect(f.write.mock.calls.map(call => call[0])).toEqual(["Keep my question add a row", "Keep my question add a row on Monday"]);
  expect(applyVoiceTranscript("x".repeat(3998), "long speech")).toHaveLength(4000);
  expect(applyVoiceTranscript("Question\n", "more")).toBe("Question\nmore");
});
it("captures text before permission and never starts after cancellation of that prompt", async () => {
  const permission = deferred<boolean>(); const f = fixture(permission.promise);
  const starting = f.manager.begin(f.capture);
  expect(f.manager.snapshot().phase).toBe("permission");
  f.manager.cancel(f.capture.scope); permission.resolve(true); await starting;
  expect(f.native.start).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  expect(f.manager.snapshot().phase).toBe("idle");
});
it("ignores permission completion when its owner, focus, consent, or foreground fence retires", async () => {
  const permission = deferred<boolean>(); const f = fixture(permission.promise);
  const starting = f.manager.begin(f.capture); f.retire(); permission.resolve(true); await starting;
  expect(f.native.start).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
});
it("denied permission keeps the draft and offers settings without sending anything", async () => {
  const f = fixture(Promise.resolve(false)); await f.manager.begin(f.capture);
  expect(f.manager.snapshot().guidance?.settings).toBe(true);
  expect(f.native.start).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
});
it("canceled recognition keeps its lease until end and ignores all late events", async () => {
  const f = fixture(); await f.manager.begin(f.capture); const old = f.events();
  f.manager.cancel(f.capture.scope); expect(f.native.abort).toHaveBeenCalledOnce();
  await f.manager.begin({ ...f.capture, scope: "new-owner" });
  expect(f.native.start).toHaveBeenCalledOnce();
  old.result("private late speech"); old.error("network");
  expect(f.write).not.toHaveBeenCalled(); old.end(); expect(f.remove).toHaveBeenCalledOnce();
  await f.manager.begin({ ...f.capture, scope: "new-owner", base: "New" });
  old.result("retired callback"); expect(f.write).not.toHaveBeenCalled();
  f.events().result("new speech"); expect(f.write).toHaveBeenCalledWith("New new speech");
});
it("deliberate stop keeps a final result editable, then releases native listeners", async () => {
  const f = fixture(); await f.manager.begin(f.capture);
  f.manager.stop(f.capture.scope); expect(f.native.stop).toHaveBeenCalledOnce();
  f.events().result("last words"); f.events().end();
  expect(f.write).toHaveBeenCalledWith("Keep my question last words");
  expect(f.manager.snapshot().phase).toBe("idle"); expect(f.remove).toHaveBeenCalledOnce();
});
it("native results cannot write after the captured authority retires", async () => {
  const f = fixture(); await f.manager.begin(f.capture); f.retire(); f.events().result("late");
  f.events().error("not-allowed"); f.events().end();
  expect(f.write).not.toHaveBeenCalled(); expect(f.manager.snapshot().guidance).toBeNull();
});
it("no-speech and interruption keep the existing draft with useful typing fallback", async () => {
  const f = fixture(); await f.manager.begin(f.capture); f.events().end();
  expect(f.manager.snapshot().guidance?.message).toContain("No speech");
  await f.manager.begin(f.capture); f.events().error("interrupted"); f.events().end();
  expect(f.manager.snapshot().guidance?.message).toContain("interrupted");
  expect(f.write).not.toHaveBeenCalled(); expect(voiceGuidance("aborted")).toBeNull();
});
it("missing or throwing native availability fails closed to typed coaching", async () => {
  const f = fixture(); const absent = createCoachVoice(null); await absent.begin(f.capture);
  expect(absent.snapshot().guidance?.message).toContain("unavailable");
  f.native.available.mockImplementation(() => { throw Error("old binary"); });
  await f.manager.begin(f.capture); expect(f.manager.snapshot().guidance?.message).toContain("unavailable");
  expect(f.native.permission).not.toHaveBeenCalled();
});
it("refuses further dictation at the message cap and retains the original text", async () => {
  const f = fixture(); await f.manager.begin({ ...f.capture, base: "x".repeat(4000) });
  expect(f.native.permission).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  expect(f.manager.snapshot().guidance?.message).toContain("4,000");
});
