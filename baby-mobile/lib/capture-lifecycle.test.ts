import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, type DeviceState, type EditorDraft, type LocalFile } from "./models";
import { ApiError } from "./api";
import { keepInPersonal, notSentMessage } from "./outbox";
const scope = vi.hoisted(() => ({
  account: null as unknown, foreground: null as null | ((state: string) => void),
  alerts: [] as { title: string; buttons: { text: string; onPress?: () => void }[] }[],
  params: { kind: "journal" }, native: true,
  pending: vi.fn(), returnClaim: vi.fn(), acknowledge: vi.fn(), copy: vi.fn(), remove: vi.fn(),
  push: vi.fn(), dismiss: vi.fn(), reset: vi.fn(), toast: vi.fn(),
  stock: { hasShareIntent: false, shareIntent: { webUrl: "", text: "", files: [] as unknown[] } },
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" }, View: "View", Image: "Image",
  Alert: { alert: (title: string, _message: string, buttons = []) => scope.alerts.push({ title, buttons }) },
  AppState: { addEventListener: (_: string, fn: (state: string) => void) => {
    scope.foreground = fn; return { remove() { scope.foreground = null; } };
  } },
}));
vi.mock("expo-router", () => ({ useNavigationContainerRef: () => ({ getRootState: () => undefined }), useLocalSearchParams: () => scope.params,
  router: { push: scope.push, dismissTo: scope.dismiss, back: vi.fn() } }));
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `fixture-${++id}` }; });
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-image-picker", () => ({}));
vi.mock("expo-share-intent", () => ({ useShareIntentContext: () => ({ ...scope.stock, resetShareIntent: scope.reset }) }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/outbox", () => import("./outbox"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/care-glance", () => import("./care-glance"));
vi.mock("@/lib/quick-care", () => import("./quick-care"));
vi.mock("@/lib/events", () => import("./events"));
vi.mock("@/lib/visits", () => import("./visits"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/components/event-fields", () => ({ EventFields: "EventFields" }));
vi.mock("../lib/stock-share-scope", () => ({ stockShareScope: { allow: () => true } }));
vi.mock("@/lib/use-share-session", () => ({ useShareSession: vi.fn() }));
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/files", () => ({ preserveFile: scope.copy, removeLocal: scope.remove }));
vi.mock("@/lib/reminders", () => ({ requestReminders: vi.fn() }));
vi.mock("@/components/date-field", () => ({ DateField: "DateField" }));
vi.mock("@/components/collection-sources", () => ({ CollectionSources: "CollectionSources" }));
vi.mock("../components/journal-composer", () => ({ JournalComposer: "JournalComposer", ComposerOpening: "ComposerOpening" }));
vi.mock("@/modules/hafa-baby-share/src", () => ({
  get nativeSharingAvailable() { return scope.native; }, pendingShare: scope.pending, acknowledgeShare: scope.acknowledge, returnClaim: scope.returnClaim,
}));
vi.mock("@/components/ui", () => ({
  Button: "Button", Card: "Card", Chips: "Chips", Choice: "Choice", Copy: "Copy", Field: "Field",
  Loading: "Loading", Notice: "Notice", Screen: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => React.createElement("Screen", null, children, footer), Section: "Section", useToast: () => scope.toast,
}));
import Edit from "../app/edit";
import { ShareCapture, sharedSourceTitle } from "../components/share-capture";
import { onClaimSettled } from "./share-session-state";
let renderer: ReactTestRenderer | undefined;
function held<T>() { let release!: (value: T) => void; const promise = new Promise<T>((resolve) => { release = resolve; }); return { promise, release }; }
function setup() {
  let active = true, writes = Promise.resolve(), commitGate: Promise<void> | undefined;
  const account = {
    owner: "disposable-local-parent", ready: true, online: false, records: [], current: () => active,
    state: { ...emptyState(), bootstrap: { generation: 1, active: true, ai_available: false, children: [],
      profile: { ai_consent: false, timezone: "Pacific/Guam", display_name: "Parent" } } } as DeviceState,
    commit: vi.fn((update: (state: DeviceState) => DeviceState) => {
      writes = writes.catch(() => undefined).then(async () => { await commitGate; account.state = update(account.state); }); return writes;
    }),
    saveDraft: vi.fn((key: string, draft: EditorDraft | null) => {
      writes = writes.catch(() => undefined).then(() => {
        const drafts = { ...account.state.drafts }; if (draft) drafts[key] = draft; else delete drafts[key];
        account.state = { ...account.state, drafts };
      }); return writes;
    }),
    refresh: vi.fn(),
    holdCommit: (gate: Promise<void>) => { commitGate = gate; }, sync: vi.fn(), retire: () => { active = false; }, drain: () => writes,
  };
  scope.account = account;
  return account;
}
async function mount(component: typeof Edit | typeof ShareCapture) {
  await act(async () => { renderer = TestRenderer.create(React.createElement(component)); });
}
async function press(text: string) {
  const button = renderer!.root.findAll((node) => String(node.type) === "Button" && node.props.title === text)[0];
  expect(button, text).toBeDefined();
  await act(async () => { button.props.onPress(); });
}
const composer = () => renderer!.root.findAll((node) => String(node.type) === "JournalComposer")[0].props;
const payload = (token = "capture-A", files: unknown[] = []) => ({ token, capture_id: token, record_id: token,
  scope: "disposable-local-parent:1", occurred_at: "2026-10-21T07:50:00.123Z", url: "https://example.test/advice", text: "Saved tip", files });
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); scope.alerts = []; scope.native = true;
  scope.stock = { hasShareIntent: false, shareIntent: { webUrl: "", text: "", files: [] } };
  scope.pending.mockResolvedValue(null); scope.acknowledge.mockReturnValue(true); scope.remove.mockResolvedValue(undefined);
  scope.copy.mockImplementation(async (_owner, file) => ({ id: file.uri, uri: "file:///private/" + file.name,
    name: file.name, mime_type: file.mimeType }));
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated")) throw Error(String(args[0]));
  });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });
it("sets a sleep's end on the family's clock, like its start", async () => {
  setup();
  const before = scope.params;
  scope.params = { kind: "sleep" };
  await mount(Edit);
  await act(async () => renderer!.root.findAll((node) => String(node.type) === "Choice" && node.props.label === "Sleep has ended")[0].props.onPress());
  const fields = renderer!.root.findAll((node) => String(node.type) === "DateField");
  expect(fields.find((field) => field.props.label === "Sleep started")?.props.timeZone).toBe("Pacific/Guam");
  expect(fields.find((field) => field.props.label === "Sleep ended")?.props.timeZone).toBe("Pacific/Guam");
  scope.params = before;
});
it("does not recreate a saved draft when its serialized commit is held through autosave, background and unmount", async () => {
  const account = setup(), gate = held<void>();
  account.holdCommit(gate.promise);
  await mount(Edit);
  await act(async () => composer().change({ body: "A memory to keep" }));
  await act(async () => composer().onSave());
  await act(async () => { await vi.advanceTimersByTimeAsync(450); scope.foreground?.("background"); renderer!.unmount(); });
  renderer = undefined;
  await act(async () => { gate.release(); await gate.promise; await account.drain(); });
  expect(account.state.outbox).toHaveLength(1);
  expect(account.state.drafts).toEqual({});
});
it("lets an unchanged zero-minute feed through, and still stops a zero she typed", async () => {
  const account = setup(), feed = { id: "feed", kind: "feeding", title: "Feeding", body: "", child_id: null, occurred_at: "2026-10-21T07:50:00.000Z", revision: 2, created_at: "", updated_at: "",
    data: { method: "breast", side: "left", duration_minutes: 0 } };
  (account as { records: unknown[] }).records = [feed];
  const before = scope.params;
  scope.params = { id: "feed" } as unknown as typeof scope.params;
  await mount(Edit);
  await press("Save changes");
  await act(async () => { await account.drain(); });
  expect(account.state.outbox).toHaveLength(1);
  await act(async () => renderer!.unmount());
  renderer = undefined;
  (account as { records: unknown[] }).records = [{ ...feed, data: { ...feed.data, duration_minutes: 12 } }];
  account.state = { ...account.state, outbox: [] };
  await mount(Edit);
  await act(async () => renderer!.root.findAll((node) => String(node.type) === "Field" && node.props.label?.startsWith("Duration"))[0].props.onChange("0"));
  await press("Save changes");
  await act(async () => { await account.drain(); });
  expect(account.state.outbox).toHaveLength(0);
  scope.params = before;
});
describe("an editor opened while the feed's Switch was still queued", () => {
  const start = { id: "s", action: "start", at: "2026-10-21T07:50:00.000Z", side: "left" }, swap = { id: "swap", action: "switch", at: "2026-10-21T07:55:00.000Z", side: "right" };
  const feed = (revision: number, over: object = {}) => ({ id: "feed", kind: "feeding", title: "Feeding", body: "", child_id: null, occurred_at: start.at, revision, created_at: "", updated_at: "",
    data: { method: "breast", state: "running", side: "both", actions: [start, swap] }, ...over });
  const before = scope.params;
  /** The tap is queued, so what the editor shows has it in and the saved row doesn't. */
  function opened() {
    const account = setup(), saved = feed(1, { data: { method: "breast", state: "running", side: "left", actions: [start] } });
    account.state = { ...account.state, records: [saved] as never, outbox: [{ id: "swap", generation: 1, type: "feed_action", record_id: "feed", action: swap }] as never };
    (account as { records: unknown[] }).records = [feed(1)];
    scope.params = { id: "feed" } as unknown as typeof scope.params;
    return account;
  }
  const type = (body: string) => act(async () => renderer!.root.findAll((node) => String(node.type) === "Field" && node.props.label === "Notes")[0].props.onChange(body));
  const lands = (account: ReturnType<typeof setup>, row: object, settled: object) => { account.state = { ...account.state, records: [row] as never, outbox: [], settled: settled as never }; };
  const sent = (account: ReturnType<typeof setup>) => (account.state.outbox[0] as { record: { revision?: number; body: string; data: { side: string } } }).record;
  afterEach(() => { scope.params = before; });
  it("follows the Switch to the revision it made, and keeps what she typed", async () => {
    const account = opened();
    await mount(Edit);
    await type("Sleepy today");
    lands(account, feed(2), { swap: { made: 2 } });
    await press("Save changes");
    await act(async () => { await account.drain(); });
    expect(sent(account)).toMatchObject({ revision: 2, body: "Sleepy today" });
  });
  it("does the same for a draft kept while the app was closed", async () => {
    const account = opened();
    await mount(Edit);
    await type("Sleepy today");
    await act(async () => { await vi.advanceTimersByTimeAsync(450); renderer!.unmount(); await account.drain(); });
    renderer = undefined;
    expect(account.state.drafts["record:feed"]).toMatchObject({ revision: 1, body: "Sleepy today" });
    lands(account, feed(2), { swap: { made: 2 } });
    await mount(Edit);
    await press("Save changes");
    await act(async () => { await account.drain(); });
    expect(sent(account)).toMatchObject({ revision: 2, body: "Sleepy today" });
  });
  it("doesn't follow the row to a revision the Switch didn't make: the other phone's write goes to review", async () => {
    const account = opened();
    await mount(Edit);
    await type("Sleepy today");
    lands(account, feed(7, { body: "From the other phone" }), { swap: { made: 5 } });
    await press("Save changes");
    await act(async () => { await account.drain(); });
    expect(sent(account).revision).toBe(1);
  });
  it("doesn't follow a tap it never saw, when it was opened before that tap", async () => {
    const account = setup(), saved = feed(1, { data: { method: "breast", state: "running", side: "left", actions: [start] } });
    account.state = { ...account.state, records: [saved] as never };
    (account as { records: unknown[] }).records = [saved];
    scope.params = { id: "feed" } as unknown as typeof scope.params;
    await mount(Edit);
    await type("Sleepy today");
    lands(account, feed(2), { swap: { made: 2 } });
    await press("Save changes");
    await act(async () => { await account.drain(); });
    expect(sent(account).revision).toBe(1);
  });
  it("leaves what she's writing exactly as it is when the Switch is discarded behind it", async () => {
    const account = opened();
    await mount(Edit);
    await type("Sleepy today");
    account.state = { ...account.state, outbox: [], settled: { swap: { discarded: true } } };
    await act(async () => { renderer!.update(React.createElement(Edit)); });
    await press("Save changes");
    await act(async () => { await account.drain(); });
    expect(sent(account)).toMatchObject({ revision: 1, body: "Sleepy today" });
    expect(sent(account).data).toEqual(feed(1).data);
    expect(account.state.outbox[0]).toMatchObject({ base: { after: [] } });
  });
  it("does the same for a kept draft, and it goes back to the saved row's revision", async () => {
    const account = opened();
    await mount(Edit);
    await type("Sleepy today");
    await act(async () => { await vi.advanceTimersByTimeAsync(450); renderer!.unmount(); await account.drain(); });
    renderer = undefined;
    const kept = account.state.drafts["record:feed"];
    account.state = { ...account.state, outbox: [], settled: { swap: { discarded: true } }, drafts: { "record:feed": { ...kept, revision: 4 } as never } };
    await mount(Edit);
    await press("Save changes");
    await act(async () => { await account.drain(); });
    expect(sent(account)).toMatchObject({ revision: 1, body: "Sleepy today" });
  });
  it("doesn't take on a revision the other phone made, when the Switch it was built on is discarded", async () => {
    const account = opened();
    await mount(Edit);
    await type("Sleepy today");
    account.state = { ...account.state, records: [feed(6, { body: "From the other phone" })] as never, outbox: [], settled: { swap: { discarded: true } } };
    await press("Save changes");
    await act(async () => { await account.drain(); });
    expect(sent(account)).toMatchObject({ revision: 1, body: "Sleepy today" });
  });
  it("still sends a draft kept by an older build at the revision of the row it opened on", async () => {
    const account = setup(), draft = { ...feed(0), revision: 0, body: "Older build", files: [], existing: true };
    account.state = { ...account.state, records: [feed(3)] as never, drafts: { "record:feed": draft as never } };
    scope.params = { id: "feed" } as unknown as typeof scope.params;
    await mount(Edit);
    await press("Save changes");
    await act(async () => { await account.drain(); });
    expect(sent(account).revision).toBe(3);
  });
});
it("resumes draft protection when the save commit fails", async () => {
  const account = setup(); account.commit.mockRejectedValueOnce(Error("Device storage unavailable"));
  await mount(Edit);
  await act(async () => composer().change({ body: "Keep this after failure" }));
  await act(async () => composer().onSave());
  await act(async () => { scope.foreground?.("background"); await account.drain(); });
  expect(account.state.outbox).toHaveLength(0);
  expect(account.state.drafts["new:journal"].body).toBe("Keep this after failure");
  expect(scope.dismiss).not.toHaveBeenCalled();
});
it("keeps Unicode caption titles identical to the restricted API creation hash", () => {
  expect(sharedSourceTitle("  " + "🍼".repeat(101) + "\nMore")).toBe("🍼".repeat(100));
  expect(sharedSourceTitle("\u0085  First line\u2028Second line ")).toBe("First line");
  expect(sharedSourceTitle("\ufeffKeep this character")).toBe("\ufeffKeep this character");
});
it("never adds stale stock-intent URLs to a native text-only capture", async () => {
  const account = setup(); scope.stock.shareIntent.webUrl = "https://example.test/earlier-account-source";
  scope.pending.mockResolvedValueOnce({ ...payload(), url: undefined, text: "Text-only capture" });
  await mount(ShareCapture);
  const saved = account.state.outbox[0];
  expect(saved.type === "save" && saved.record.data.url).toBeUndefined();
  expect(saved.type === "save" && saved.record.data.source_text).toBe("Text-only capture");
});
it("automatically saves an ordinary source without a draft, editor, modal or AI", async () => {
  const account = setup(); scope.pending.mockResolvedValueOnce(payload()); await mount(ShareCapture);
  expect(account.state.outbox).toHaveLength(1);
  expect(account.state.outbox[0]).toMatchObject({ id: "share-save:capture-A", type: "save", generation: 1,
    record: { id: "capture-A", kind: "source", title: "Saved tip", body: "", child_id: null,
      occurred_at: "2026-10-21T07:50:00.123Z", data: { url: "https://example.test/advice", source_text: "Saved tip", status: "saved" } } });
  expect(scope.acknowledge).toHaveBeenCalledExactlyOnceWith("capture-A");
  expect(account.state.drafts).toEqual({}); expect(scope.alerts).toEqual([]);
  expect(scope.push).not.toHaveBeenCalled(); expect(account.sync).toHaveBeenCalled();
});
it("drains every queued native capture in order", async () => {
  const account = setup(); scope.pending.mockResolvedValueOnce(payload("A")).mockResolvedValueOnce(payload("B"));
  await mount(ShareCapture);
  expect(account.state.outbox.map(m => m.id)).toEqual(["share-save:A", "share-save:B"]);
  expect(scope.acknowledge.mock.calls.map(call => call[0])).toEqual(["A", "B"]);
});
it.each([[true, false, 1], [false, true, 1], [true, true, 2]])(
  "requires both AI permission %s and share opt-in %s before adding automatic work", async (ai, auto, count) => {
    const account = setup(); Object.assign(account.state.bootstrap!.profile, { ai_consent: ai, auto_process_shares: auto });
    scope.pending.mockResolvedValueOnce(payload()); await mount(ShareCapture);
    expect(account.state.outbox).toHaveLength(count);
    if (count === 2) expect(account.state.outbox[1]).toEqual({ id: "capture-A", generation: 1,
      type: "import", record_id: "capture-A", files: [], automatic: true, automatic_epoch: 0 });
  });
it("says a claimed share is saved only once it's durably in the outbox", async () => {
  const account = setup(), { promise, release } = held<void>(), settled: string[] = [];
  const stop = onClaimSettled((token, outcome) => settled.push(`${token}:${outcome}`));
  account.holdCommit(promise);
  scope.pending.mockResolvedValueOnce({ ...payload("claimed-a"), scope: "disposable-local-parent:1:personal", claimed: true });
  await mount(ShareCapture);
  expect(settled).toEqual([]);
  expect(account.state.outbox).toEqual([]);
  await act(async () => { release(); await account.drain(); });
  expect(account.state.outbox.map(m => m.id)).toEqual(["share-save:claimed-a"]);
  expect(settled).toEqual(["claimed-a:saved"]);
  stop();
});
it("says when a claimed share couldn't be written, and keeps it", async () => {
  const account = setup(), settled: string[] = [];
  const stop = onClaimSettled((token, outcome) => settled.push(`${token}:${outcome}`));
  account.commit.mockImplementationOnce(() => Promise.reject(Error("disk full")));
  scope.pending.mockResolvedValueOnce({ ...payload("claimed-b"), scope: "disposable-local-parent:1:personal", claimed: true });
  await mount(ShareCapture);
  expect(settled).toEqual(["claimed-b:failed"]);
  expect(scope.acknowledge).not.toHaveBeenCalledWith("claimed-b");
  stop();
});
it("a share added from the waiting card never starts AI, even with automatic organizing on and matching numbers", async () => {
  const account = setup(); Object.assign(account.state.bootstrap!.profile, { ai_consent: true, auto_process_shares: true, auto_process_epoch: 0 });
  scope.pending.mockResolvedValueOnce({ ...payload(), scope: "disposable-local-parent:1:personal", claimed: true, automatic_epoch: 0 }); await mount(ShareCapture);
  expect(account.state.outbox.map(m => m.type)).toEqual(["save"]);
  expect(scope.acknowledge).toHaveBeenCalledExactlyOnceWith("capture-A");
});
it("does not copy or queue a source with an exact durable server receipt", async () => {
  const account = setup(); scope.pending.mockResolvedValueOnce({ ...payload(), status: "deferred" });
  await mount(ShareCapture);
  expect(account.state.outbox).toEqual([]); expect(scope.copy).not.toHaveBeenCalled();
  expect(account.state.imports).toEqual([{ id: "capture-A", record_id: "capture-A", status: "deferred" }]);
  expect(scope.acknowledge).toHaveBeenCalledExactlyOnceWith("capture-A"); expect(account.refresh).toHaveBeenCalled();
});
it.each(["different-owner:1", "disposable-local-parent:2", undefined])(
  "never borrows a capture from another or unknown owner/generation %s", async scopeId => {
    const account = setup(); scope.pending.mockResolvedValueOnce({ ...payload(), scope: scopeId });
    await mount(ShareCapture);
    expect(account.state.outbox).toEqual([]); expect(scope.acknowledge).not.toHaveBeenCalled();
  });
it("never acknowledges a supported subset when another attachment is refused", async () => {
  const account = setup(); scope.pending.mockResolvedValueOnce(payload("mixed", [
    { path: "file:///a.png", fileName: "a.png", mimeType: "image/png" },
    { path: "file:///a.zip", fileName: "a.zip", mimeType: "application/zip" },
  ]));
  scope.copy.mockResolvedValueOnce({ id: "a", uri: "file:///private/a.png", name: "a.png", mime_type: "image/png" })
    .mockRejectedValueOnce(Object.assign(Error("unsupported"), { code: "unsupported_file" }));
  await mount(ShareCapture);
  expect(account.state.outbox).toEqual([]); expect(scope.acknowledge).not.toHaveBeenCalled();
  expect(scope.remove).toHaveBeenCalledWith(account.owner, "file:///private/a.png");
  expect(scope.alerts.at(-1)?.title).toBe("Your shared source is still on this phone");
});
it("retains the native original after failed persistence and retries on foreground", async () => {
  const account = setup(); scope.pending.mockResolvedValue(payload("retry", [
    { path: "file:///a.png", fileName: "a.png", mimeType: "image/png" }]));
  account.commit.mockRejectedValueOnce(Error("Device full")); await mount(ShareCapture);
  expect(scope.remove).toHaveBeenCalledWith(account.owner, "file:///private/a.png");
  expect(scope.acknowledge).not.toHaveBeenCalled();
  scope.pending.mockResolvedValueOnce(payload("retry", [{ path: "file:///a.png", fileName: "a.png", mimeType: "image/png" }])).mockResolvedValue(null);
  await act(async () => scope.foreground?.("active"));
  expect(account.state.outbox).toHaveLength(1); expect(scope.acknowledge).toHaveBeenCalledExactlyOnceWith("retry");
});
it("does not duplicate or remove a durable source after interrupted acknowledgement", async () => {
  const account = setup(); scope.pending.mockResolvedValueOnce(payload("saved", [
    { path: "file:///a.png", fileName: "a.png", mimeType: "image/png" }]));
  scope.acknowledge.mockReturnValueOnce(false); await mount(ShareCapture);
  expect(account.state.outbox).toHaveLength(1); expect(scope.remove).not.toHaveBeenCalled();
  expect(account.sync).toHaveBeenCalled();
  scope.pending.mockResolvedValueOnce(payload("saved", [{ path: "file:///a.png", fileName: "a.png", mimeType: "image/png" }]));
  await act(async () => scope.foreground?.("active"));
  expect(account.state.outbox).toHaveLength(1); expect(scope.copy).toHaveBeenCalledTimes(1);
  expect(scope.remove).not.toHaveBeenCalled(); expect(scope.acknowledge).toHaveBeenCalledTimes(2);
});
it("cleans a late private copy after account retirement without saving or acknowledging", async () => {
  const account = setup(), copying = held<LocalFile>();
  scope.pending.mockResolvedValueOnce(payload("late", [{ path: "file:///a.png", fileName: "a.png", mimeType: "image/png" }]));
  scope.copy.mockReturnValueOnce(copying.promise); await mount(ShareCapture); account.retire();
  await act(async () => copying.release({ id: "a", uri: "file:///private/a.png", name: "a.png", mime_type: "image/png" }));
  expect(scope.remove).toHaveBeenCalledWith(account.owner, "file:///private/a.png");
  expect(account.state.outbox).toEqual([]); expect(scope.acknowledge).not.toHaveBeenCalled();
});
it("does not acknowledge until serialized durable storage completes", async () => {
  const account = setup(), gate = held<void>(); account.holdCommit(gate.promise);
  scope.pending.mockResolvedValueOnce(payload()); await mount(ShareCapture);
  expect(scope.acknowledge).not.toHaveBeenCalled();
  await act(async () => { gate.release(); await account.drain(); });
  expect(account.state.outbox).toHaveLength(1); expect(scope.acknowledge).toHaveBeenCalledExactlyOnceWith("capture-A");
});
it("preserves stock link and text without asking for review", async () => {
  const account = setup(); scope.native = false; scope.stock.hasShareIntent = true;
  scope.stock.shareIntent = { webUrl: "https://example.test/original", text: "Caption", files: [] };
  await mount(ShareCapture);
  expect(account.state.outbox[0]).toMatchObject({ type: "save", record: { data: { url: "https://example.test/original", source_text: "Caption" } } });
  expect(scope.reset).toHaveBeenCalledExactlyOnceWith(); expect(scope.alerts).toEqual([]);
  expect(account.sync).toHaveBeenCalled();
});
function chips() {
  return renderer!.root.findAll((node) => String(node.type) === "Chips")[0];
}
function withBaby(account: ReturnType<typeof setup>) {
  account.state = { ...account.state, bootstrap: { ...account.state.bootstrap!,
    children: [{ id: "baby-1", name: "Baby girl", revision: 1 }] } };
}
it("files a new care log under the baby even when Everything is selected", async () => {
  const account = setup(); withBaby(account); scope.params = { kind: "feeding" };
  await mount(Edit);
  expect(chips().props.value).toBe("baby-1");
  expect(chips().props.options.map((option: { value: string }) => option.value)).toEqual(["baby-1"]);
  await press("Save feeding");
  await act(async () => { await account.drain(); });
  const saved = account.state.outbox[0];
  expect(saved.type === "save" && saved.record.child_id).toBe("baby-1");
  scope.params = { kind: "journal" };
});
it("lets an older general care entry be reassigned to the baby and saves that choice", async () => {
  const account = setup(); withBaby(account);
  account.state = { ...account.state, drafts: { legacy: { id: "care-old", kind: "diaper", title: "Diaper", body: "",
    child_id: null, occurred_at: "2026-10-19T10:00:00.000Z", files: [], data: { type: "wet" }, existing: true, revision: 2 } } };
  scope.params = { kind: "diaper", draft: "legacy" } as typeof scope.params;
  await mount(Edit);
  expect(chips().props.value).toBe("");
  expect(chips().props.options.map((option: { value: string }) => option.value)).toEqual(["", "baby-1"]);
  await act(async () => chips().props.onChange("baby-1"));
  await press("Save changes");
  await act(async () => { await account.drain(); });
  const saved = account.state.outbox[0];
  expect(saved.type === "save" && saved.record.child_id).toBe("baby-1");
  scope.params = { kind: "journal" };
});
it("asks which baby a care log is for when there are several and none is selected", async () => {
  const account = setup();
  account.state = { ...account.state, bootstrap: { ...account.state.bootstrap!, children: [
    { id: "twin-a", name: "A", revision: 1 }, { id: "twin-b", name: "B", revision: 1 }] } };
  scope.params = { kind: "diaper" };
  await mount(Edit);
  expect(chips().props.value).toBe("");
  await press("Save diaper");
  await act(async () => { await account.drain(); });
  expect(account.state.outbox).toHaveLength(0);
  const notice = renderer!.root.findAll((node) => String(node.type) === "Notice")[0];
  expect(notice.props.children).toBe("Choose which baby this is for.");
  await act(async () => chips().props.onChange("twin-b"));
  await press("Save diaper");
  await act(async () => { await account.drain(); });
  const saved = account.state.outbox[0];
  expect(saved.type === "save" && saved.record.child_id).toBe("twin-b");
  scope.params = { kind: "journal" };
});
it("keeps an existing care entry on its own baby when another baby is selected", async () => {
  const account = setup();
  account.state = { ...account.state, selectedChild: "twin-a", bootstrap: { ...account.state.bootstrap!, children: [
    { id: "twin-a", name: "A", revision: 1 }, { id: "twin-b", name: "B", revision: 1 }] },
    drafts: { mine: { id: "care-b", kind: "feeding", title: "Feeding", body: "", child_id: "twin-b",
      occurred_at: "2026-10-19T10:00:00.000Z", files: [], data: { method: "bottle" }, existing: true, revision: 3 } } };
  scope.params = { kind: "feeding", draft: "mine" } as typeof scope.params;
  await mount(Edit);
  await press("Save changes");
  await act(async () => { await account.drain(); });
  const saved = account.state.outbox[0];
  expect(saved.type === "save" && saved.record.child_id).toBe("twin-b");
  scope.params = { kind: "journal" };
});
it("prefills the other breast, returns to Today and offers an Undo that removes the new feed", async () => {
  const account = setup(); withBaby(account); scope.params = { kind: "feeding" };
  (account as { records: unknown[] }).records = [{ id: "older", kind: "feeding", title: "Feeding", body: "", child_id: "baby-1",
    occurred_at: "2026-10-20T01:00:00.000Z", data: { method: "breast", side: "left", duration_minutes: 12 }, revision: 1,
    created_at: "", updated_at: "" }];
  (account as unknown as { queue: (m: unknown) => Promise<void> }).queue = (m) =>
    account.commit((state) => ({ ...state, outbox: [...state.outbox, m as DeviceState["outbox"][number]] }));
  await mount(Edit);
  const side = renderer!.root.findAll((node) => String(node.type) === "Chips")
    .find((node) => node.props.options.some((option: { value: string }) => option.value === "right"));
  expect(side!.props.value).toBe("right");
  await press("Save feeding");
  await act(async () => { await account.drain(); });
  expect(scope.dismiss).toHaveBeenCalledWith("/(tabs)/(today)");
  const [message, action] = scope.toast.mock.calls.at(-1)!;
  expect(message).toContain("Breastfeeding · Right side");
  expect(action.label).toBe("Undo");
  await act(async () => { await action.onPress(); await account.drain(); });
  const [saved, removed] = account.state.outbox;
  expect(saved.type).toBe("save");
  expect(removed.type === "delete" && removed.record.id).toBe(saved.type === "save" && saved.record.id);
  scope.params = { kind: "journal" };
});

it("keeps a native original without processing when its captured permission epoch is retired", async () => {
  const account = setup();
  Object.assign(account.state.bootstrap!.profile, { ai_consent: true, auto_process_shares: true, auto_process_epoch: 2 });
  scope.pending.mockResolvedValueOnce({ ...payload(), automatic_epoch: 1 });
  await mount(ShareCapture);
  expect(account.state.outbox).toHaveLength(1);
  expect(account.state.outbox[0].type).toBe("save");
});

it("keeps an untitled source eligible for a processed title and saves the complete original", async () => {
  const account = setup(); Object.assign(scope.params, { kind: "source" });
  await mount(Edit);
  const text = "Changing station checklist\nKeep wipes and a spare outfit nearby.";
  await act(async () => renderer!.root.findAll(node => String(node.type) === "Field" && node.props.label === "Your notes or pasted source text")[0].props.onChange(text));
  await press("Save post"); await account.drain();
  expect(account.state.outbox[0]).toMatchObject({ type: "save", record: { title: "Saved source", body: text, data: { source_text: text } } });
});
it("persists queued native progress before acknowledging a durable receipt", async () => {
  const account = setup(), gate = held<void>(); account.holdCommit(gate.promise);
  scope.pending.mockResolvedValueOnce({ ...payload(), status: "queued", import_id: "capture-A" });
  await mount(ShareCapture);
  expect(scope.acknowledge).not.toHaveBeenCalled();
  await act(async () => { gate.release(); await account.drain(); });
  expect(account.state.imports).toEqual([{ id: "capture-A", record_id: "capture-A", status: "queued" }]);
  expect(scope.acknowledge).toHaveBeenCalledExactlyOnceWith("capture-A");
});

describe("a draft from before the family", () => {
  it("stays personal when it's saved after joining", async () => {
    const account = setup(), personal = "personal-space", family = "family-space";
    Object.assign(account.state.bootstrap!, { personal_space_id: personal, spaces: [{ id: personal, kind: "personal", role: "parent", generation: 1, access_version: 1 }, { id: family, kind: "family", role: "parent", generation: 1, access_version: 1 }] });
    account.state.drafts["new:source"] = { id: "kept", kind: "source", title: "", body: "Private words", child_id: null, occurred_at: "2026-10-21T00:00:00.000Z", data: {}, files: [], space_id: personal, generation: 1 };
    const before = scope.params;
    scope.params = { kind: "source" };
    await mount(Edit);
    const save = renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.title === "Save post")!;
    await act(async () => { await save.props.onPress(); await vi.advanceTimersByTimeAsync(0); });
    expect(account.state.outbox[0]).toMatchObject({ space_id: personal, record: { id: "kept" } });
    scope.params = before;
  });
});

it("retries a failed acknowledgement and lets later claimed captures settle", async () => {
  const account = setup(), first = { ...payload(), claimed: true }, second = { ...payload("capture-B"), claimed: true };
  scope.pending.mockResolvedValueOnce(first).mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValue(null);
  scope.acknowledge.mockReturnValueOnce(false).mockReturnValue(true);
  await mount(ShareCapture);
  await act(async () => { await account.drain(); });
  expect(account.state.outbox).toHaveLength(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(500); await account.drain(); });
  expect(account.state.outbox).toHaveLength(2);
  expect(scope.acknowledge).toHaveBeenCalledWith("capture-B");
});
it("returns an Add overtaken by a personal reset without deleting it", async () => {
  const account = setup();
  account.state.bootstrap!.generation = 2;
  scope.returnClaim.mockResolvedValue(true);
  scope.pending.mockResolvedValueOnce({ ...payload(), claimed: true }).mockResolvedValue(null);
  await mount(ShareCapture);
  await act(async () => { await account.drain(); });
  expect(scope.returnClaim).toHaveBeenCalledWith("capture-A", "disposable-local-parent");
  expect(scope.acknowledge).not.toHaveBeenCalled();
  expect(account.state.outbox).toHaveLength(0);
  expect(scope.alerts.some(alert => alert.title === "Your share is still on this phone")).toBe(true);
});
describe("captures from an older build, after the update and after Create family", () => {
  const family = "11111111-1111-4111-8111-111111111111", personal = "22222222-2222-4222-8222-222222222222";
  const shared = (spaces: object[]) => ({ personal_space_id: personal, spaces: [{ id: personal, kind: "personal", role: "parent", generation: 1, access_version: 1 }, ...spaces] });
  const capture = (over: object = {}) => ({ token: "capture-a:hash", capture_id: "capture-a", record_id: "capture-a", scope: "disposable-local-parent:1", occurred_at: "2026-10-21T07:50:00.123Z", url: "https://example.test/advice", text: "Saved tip", files: [], ...over });
  const drain = async (account: ReturnType<typeof setup>) => {
    await act(async () => { renderer = TestRenderer.create(React.createElement(ShareCapture)); await vi.advanceTimersByTimeAsync(0); });
    await account.drain();
  };
  it("keeps a capture made before spaces personal, under its own id, once there's a family", async () => {
    const account = setup();
    Object.assign(account.state.bootstrap!, shared([{ id: family, kind: "family", role: "parent", generation: 1, access_version: 1 }]));
    scope.pending.mockResolvedValueOnce(capture()).mockResolvedValue(null);
    await drain(account);
    expect(account.state.outbox[0]).toMatchObject({ id: "share-save:capture-a", space_id: personal, record: { id: "capture-a" } });
    expect(scope.acknowledge).toHaveBeenCalledWith("capture-a:hash");
  });
  it("stays personal even if bootstrap lists the family while the capture is being saved", async () => {
    const account = setup(), commit = account.commit;
    // The drain starts on what this phone saved before spaces. The answer lands before its write runs.
    account.commit = vi.fn((update: (state: DeviceState) => DeviceState) => {
      Object.assign(account.state.bootstrap!, shared([{ id: family, kind: "family", role: "parent", generation: 1, access_version: 1 }]));
      return commit(update);
    }) as typeof account.commit;
    scope.pending.mockResolvedValueOnce(capture()).mockResolvedValue(null);
    await drain(account);
    expect(account.state.outbox[0]).toMatchObject({ id: "share-save:capture-a", space_id: personal, record: { id: "capture-a" } });
  });
  it("says nothing when the first bootstrap ends a lease mid-write, and saves it on the next go", async () => {
    const account = setup(), commit = account.commit;
    let first = true;
    account.commit = vi.fn((update: (state: DeviceState) => DeviceState) => {
      if (first) { first = false; return Promise.reject(new ApiError("This request belongs to an earlier Baby space and was stopped.", 410, true)); }
      return commit(update);
    }) as typeof account.commit;
    scope.pending.mockResolvedValue(capture());
    scope.acknowledge.mockImplementation(() => { scope.pending.mockResolvedValue(null); return true; });
    await drain(account);
    expect(scope.alerts).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    await account.drain();
    expect(account.state.outbox[0]).toMatchObject({ id: "share-save:capture-a" });
    expect(scope.acknowledge).toHaveBeenCalledWith("capture-a:hash");
  });
  it("takes a capture tagged for an earlier destination of this account, which only a build before this couldn't read", async () => {
    const account = setup();
    Object.assign(account.state.bootstrap!, shared([{ id: family, kind: "family", role: "parent", generation: 1, access_version: 1 }]));
    scope.pending.mockResolvedValueOnce(capture({ scope: `disposable-local-parent:1:${family}` })).mockResolvedValue(null);
    await drain(account);
    expect(account.state.outbox[0]).toMatchObject({ space_id: family, generation: 1, record: { id: "capture-a" } });
  });
  it("holds one made for a family she's left as Not sent, under its id, since the family may already have it", async () => {
    const account = setup();
    Object.assign(account.state.bootstrap!, shared([]));
    account.state.bootstrap!.profile.ai_consent = true;
    (account.state.bootstrap!.profile as { auto_process_shares?: boolean }).auto_process_shares = true;
    scope.pending.mockResolvedValueOnce(capture({ scope: `disposable-local-parent:1:${family}` })).mockResolvedValue(null);
    await drain(account);
    expect(account.state.outbox).toHaveLength(1);
    expect(account.state.outbox[0]).toMatchObject({ id: "share-save:capture-a", space_id: family, left_space: family, error: notSentMessage, record: { id: "capture-a" } });
    expect(scope.acknowledge).toHaveBeenCalledWith("capture-a:hash");
    // Keep is what copies it, under a new id.
    const kept = keepInPersonal(account.state, account.state.outbox[0], () => "copy");
    expect(kept.outbox[0]).toMatchObject({ space_id: personal, record: { id: "copy" } });
    expect(kept.outbox[0].left_space).toBeUndefined();
  });
  it("retires one from before her space was cleared, so a later capture isn't stuck behind it", async () => {
    const account = setup();
    account.state.bootstrap!.generation = 2;
    scope.pending.mockResolvedValueOnce(capture({ scope: "disposable-local-parent:1" })).mockResolvedValueOnce(capture({ scope: "disposable-local-parent:2", token: "capture-b:hash", capture_id: "capture-b", record_id: "capture-b" })).mockResolvedValue(null);
    await drain(account);
    expect(scope.acknowledge).toHaveBeenCalledWith("capture-a:hash");
    expect(account.state.outbox.map((m) => m.id)).toEqual(["share-save:capture-b"]);
  });
  it("keeps a receipt's job and retires it only after that's saved", async () => {
    const account = setup();
    Object.assign(account.state.bootstrap!, shared([{ id: family, kind: "family", role: "parent", generation: 1, access_version: 1 }]));
    scope.pending.mockResolvedValueOnce(capture({ status: "queued", import_id: "capture-a" })).mockResolvedValue(null);
    await drain(account);
    expect(account.state.imports).toMatchObject([{ id: "capture-a", record_id: "capture-a", status: "queued" }]);
    expect(scope.acknowledge).toHaveBeenCalledWith("capture-a:hash");
  });
  it("still leaves another account's capture alone", async () => {
    const account = setup();
    scope.pending.mockResolvedValueOnce(capture({ scope: "someone-else:1" }));
    await drain(account);
    expect(account.state.outbox).toEqual([]);
    expect(scope.acknowledge).not.toHaveBeenCalled();
  });
});

it("uses a recovered capture’s fresh record identity instead of its erased id", async () => {
  const account = setup();
  scope.pending.mockResolvedValueOnce({ ...payload(), record_id: "fresh-record", claimed: true }).mockResolvedValue(null);
  await mount(ShareCapture); await account.drain();
  expect(account.state.outbox[0]).toMatchObject({ id: "share-save:fresh-record", record: { id: "fresh-record" } });
});

it("settles a claimed retained receipt only after saving its original", async () => {
  const account = setup();
  scope.pending.mockResolvedValueOnce({ ...payload(), status: "saved", claimed: true }).mockResolvedValue(null);
  const settled = vi.fn(), stop = onClaimSettled(settled);
  try {
    await mount(ShareCapture); await account.drain();
    expect(account.state.outbox[0]).toMatchObject({ type: "save" });
    expect(settled).toHaveBeenCalledWith("capture-A", "saved");
  } finally { stop(); }
});
