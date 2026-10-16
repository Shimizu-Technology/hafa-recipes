import { createElement, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCoachVoice, type Recognition } from "./coach-voice";

const f = vi.hoisted(() => ({ manager: null as ReturnType<typeof createCoachVoice> | null,
  state: "active", current: true, app: new Set<(state: string) => void>(), blur: null as null | (() => void), settings: vi.fn() }));
vi.mock("./coach-speech-recognition", () => ({ get coachVoice() { return f.manager; } }));
vi.mock("react-native", () => ({ AppState: { get currentState() { return f.state; },
  addEventListener: (_: string, callback: (state: string) => void) => { f.app.add(callback); return { remove: () => f.app.delete(callback) }; } }, Linking: { openSettings: f.settings } }));
vi.mock("expo-router", async () => {
  const { useLayoutEffect } = await import("react");
  return { useFocusEffect: (callback: () => (() => void)) => useLayoutEffect(() => { const cleanup = callback(); f.blur = cleanup; return cleanup; }, [callback]) };
});
import { useCoachVoice } from "./use-coach-voice";

let renderer: ReactTestRenderer | undefined;
let events: Parameters<Recognition["listen"]>[0], native: Recognition & { start: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> };
const identity = {};
type Props = { scope: string; enabled?: boolean; identity?: unknown; beforeCapture?(): Promise<void> };
function Harness({ scope, enabled = true, identity: ownerStorage = identity, beforeCapture }: Props) {
  const [message, setMessage] = useState("Typed base");
  const voice = useCoachVoice({ scope, identity: ownerStorage, enabled, message, current: () => f.current, write: setMessage, beforeCapture });
  return createElement("Fixture", { voice, message, type: (text: string) => { voice.cancel(); setMessage(text); }, send: () => voice.cancel() });
}
const view = () => renderer!.root.findByType("Fixture" as never).props;
async function mount(props: Props = { scope: "owner:1:focus:consent" }) { await act(async () => { renderer = create(createElement(Harness, props)); }); }
async function update(props: Props) { await act(async () => { renderer!.update(createElement(Harness, props)); }); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f.state = "active"; f.current = true; f.app.clear(); f.settings.mockReset(); f.settings.mockResolvedValue(undefined);
  native = { available: () => true, permission: async () => true, listen: handlers => { events = handlers; return vi.fn(); }, start: vi.fn<() => void>(), stop: vi.fn<() => void>(), abort: vi.fn<() => void>() };
  f.manager = createCoachVoice(native);
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });
it("updates the mounted editable draft without a send side effect and stops when typing takes over", async () => {
  await mount(); await act(async () => view().voice.toggle());
  await act(async () => events.result("add squats")); expect(view().message).toBe("Typed base add squats");
  await act(async () => events.result("add rows")); expect(view().message).toBe("Typed base add rows");
  await act(async () => view().type("My edited question"));
  await act(async () => events.result("late")); expect(view().message).toBe("My edited question");
  expect(native.abort).toHaveBeenCalledOnce();
});
it.each(["account", "generation", "focus", "consent"])("retires voice callbacks on a committed %s change", async key => {
  await mount(); await act(async () => view().voice.toggle());
  await update({ scope: `changed:${key}` });
  await act(async () => events.result("late prior scope"));
  expect(view().message).toBe("Typed base"); expect(native.abort).toHaveBeenCalled();
});
it("retires recognition on storage replacement, blur, and background", async () => {
  await mount(); await act(async () => view().voice.toggle()); await update({ scope: "owner:1:focus:consent", identity: {} });
  await act(async () => events.result("retired storage")); expect(view().message).toBe("Typed base");
  await act(async () => events.end()); await act(async () => view().voice.toggle());
  await act(async () => { f.state = "background"; f.app.forEach(callback => callback("background")); events.result("background"); });
  expect(view().message).toBe("Typed base");
  await act(async () => events.end()); f.state = "active"; await act(async () => view().voice.toggle());
  await act(async () => { f.blur?.(); events.result("blurred"); }); expect(view().message).toBe("Typed base");
});
it("permission-prompt inactivity does not cancel the prompt; backgrounding does", async () => {
  let grant!: (value: boolean) => void;
  native.permission = () => new Promise(resolve => { grant = resolve; });
  await mount(); await act(async () => view().voice.toggle());
  await act(async () => { f.state = "inactive"; f.app.forEach(callback => callback("inactive")); });
  expect(view().voice.phase).toBe("permission");
  await act(async () => { f.state = "active"; grant(true); }); expect(native.start).toHaveBeenCalledOnce();
  await act(async () => events.end()); await act(async () => view().voice.toggle());
  await act(async () => { f.state = "background"; f.app.forEach(callback => callback("background")); });
  await act(async () => { f.state = "active"; grant(true); }); expect(native.start).toHaveBeenCalledOnce();
});
it("pending permission cannot start recording after send or unmount", async () => {
  let grant!: (value: boolean) => void;
  native.permission = () => new Promise(resolve => { grant = resolve; });
  await mount(); await act(async () => view().voice.toggle());
  await act(async () => view().send()); await act(async () => grant(true)); expect(native.start).not.toHaveBeenCalled();
  await act(async () => view().voice.toggle()); await act(async () => renderer!.unmount()); renderer = undefined;
  await act(async () => grant(true)); expect(native.start).not.toHaveBeenCalled();
});
it("disabling dictation cancels recognition without removing typed text", async () => {
  await mount(); await act(async () => view().voice.toggle()); await update({ scope: "owner:1:focus:consent", enabled: false });
  await act(async () => events.result("late after consent revoked")); expect(view().message).toBe("Typed base");
  expect(native.abort).toHaveBeenCalled();
});

function deferredStop() { let resolve!: () => void, reject!: (reason: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
it("awaits confirmed speech Stop before requesting permission and recognition", async () => {
  const stop = deferredStop(), beforeCapture = vi.fn(() => stop.promise), permission = vi.fn(async () => true); native.permission = permission;
  await mount({ scope: "reader", beforeCapture }); await act(async () => view().voice.toggle());
  expect(view().voice.preparing).toBe(true); expect(permission).not.toHaveBeenCalled(); expect(native.start).not.toHaveBeenCalled();
  await act(async () => stop.resolve()); expect(permission).toHaveBeenCalledOnce(); expect(native.start).toHaveBeenCalledOnce();
});
it("a failed speech Stop leaves the draft intact and never starts capture; explicit retry can proceed", async () => {
  const beforeCapture = vi.fn().mockRejectedValueOnce(Error("uncertain Stop")).mockResolvedValue(undefined);
  await mount({ scope: "reader", beforeCapture }); await act(async () => view().voice.toggle());
  expect(view().voice.preparationError).toContain("Could not confirm speech stopped"); expect(native.start).not.toHaveBeenCalled(); expect(view().message).toBe("Typed base");
  await act(async () => view().voice.toggle()); expect(native.start).toHaveBeenCalledOnce();
});
it.each(["typing", "cancel", "scope", "background", "unmount"])("a speech Stop wait cannot start the microphone after %s retires it", async retirement => {
  const stop = deferredStop(); await mount({ scope: "reader", beforeCapture: () => stop.promise }); await act(async () => view().voice.toggle());
  if (retirement === "typing") await act(async () => view().type("My edited draft"));
  if (retirement === "cancel") await act(async () => view().voice.toggle());
  if (retirement === "scope") await update({ scope: "new-reader" });
  if (retirement === "background") await act(async () => { f.state = "background"; f.app.forEach(callback => callback("background")); });
  if (retirement === "unmount") { await act(async () => renderer!.unmount()); renderer = undefined; }
  await act(async () => stop.resolve()); expect(native.start).not.toHaveBeenCalled();
});

it("a retained toggle cannot cancel a new speech-stop preparation after same-scope identity replacement", async () => {
  await mount({ scope: "same-scope", identity: {} }); const oldToggle = view().voice.toggle;
  const stop = deferredStop(); await update({ scope: "same-scope", identity: {}, beforeCapture: () => stop.promise });
  await act(async () => view().voice.toggle()); expect(view().voice.preparing).toBe(true);
  await act(async () => oldToggle()); expect(view().voice.preparing).toBe(true);
  await act(async () => stop.resolve()); expect(native.start).toHaveBeenCalledOnce();
});
it("retained toggle and cancel cannot stop replacement recognition under the same scope string", async () => {
  const stop = vi.fn<() => void>(); native.stop = stop;
  await mount({ scope: "same-scope", identity: {} }); const oldToggle = view().voice.toggle, oldCancel = view().voice.cancel;
  await update({ scope: "same-scope", identity: {} }); await act(async () => view().voice.toggle()); expect(native.start).toHaveBeenCalledOnce();
  await act(async () => { oldToggle(); oldCancel(); }); expect(stop).not.toHaveBeenCalled(); expect(native.abort).not.toHaveBeenCalled(); expect(view().voice.phase).toBe("listening");
});

it("retires capture when the same committed authority object becomes invalid", async () => {
  await mount(); await act(async () => view().voice.toggle());
  f.current = false; await update({ scope: "owner:1:focus:consent" });
  await act(async () => events.result("Retired private result"));
  expect(native.abort).toHaveBeenCalledOnce(); expect(view().message).toBe("Typed base");
  await act(async () => view().voice.toggle()); expect(native.start).toHaveBeenCalledOnce();
});
