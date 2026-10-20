import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, type DeviceState, type EditorDraft, type LocalFile } from "./models";
const scope = vi.hoisted(() => ({
  account: null as unknown, foreground: null as null | ((state: string) => void),
  alerts: [] as { title: string; buttons: { text: string; onPress?: () => void }[] }[],
  params: { kind: "journal" }, native: true,
  pending: vi.fn(), acknowledge: vi.fn(), copy: vi.fn(), remove: vi.fn(),
  push: vi.fn(), dismiss: vi.fn(), reset: vi.fn(),
  stock: { hasShareIntent: false, shareIntent: { webUrl: "", text: "", files: [] as unknown[] } },
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" }, View: "View", Image: "Image",
  Alert: { alert: (title: string, _message: string, buttons = []) => scope.alerts.push({ title, buttons }) },
  AppState: { addEventListener: (_: string, fn: (state: string) => void) => {
    scope.foreground = fn; return { remove() { scope.foreground = null; } };
  } },
}));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => scope.params,
  router: { push: scope.push, dismissTo: scope.dismiss, back: vi.fn() } }));
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `fixture-${++id}` }; });
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-image-picker", () => ({}));
vi.mock("expo-share-intent", () => ({ useShareIntentContext: () => ({ ...scope.stock, resetShareIntent: scope.reset }) }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/outbox", () => import("./outbox"));
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/files", () => ({ preserveFile: scope.copy, removeLocal: scope.remove }));
vi.mock("@/lib/reminders", () => ({ requestReminders: vi.fn() }));
vi.mock("@/components/date-field", () => ({ DateField: "DateField" }));
vi.mock("@/components/collection-sources", () => ({ CollectionSources: "CollectionSources" }));
vi.mock("@/modules/hafa-baby-share/src", () => ({
  get nativeSharingAvailable() { return scope.native; }, pendingShare: scope.pending, acknowledgeShare: scope.acknowledge,
}));
vi.mock("@/components/ui", () => ({
  Button: "Button", Card: "Card", Chips: "Chips", Choice: "Choice", Copy: "Copy", Field: "Field",
  Loading: "Loading", Notice: "Notice", Screen: "Screen", Section: "Section", useToast: () => () => {},
}));
import Edit from "../app/edit";
import { ShareCapture } from "../components/share-capture";
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
async function alertPress(title: string, text: string) {
  const alert = [...scope.alerts].reverse().find((item) => item.title === title);
  expect(alert, title).toBeDefined();
  await act(async () => { alert!.buttons.find((item) => item.text === text)!.onPress?.(); });
}
const payload = (token = "capture-A", files: unknown[] = []) => ({ token, url: "https://example.test/advice", text: "Saved tip", files });
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
it("does not recreate a saved draft when its serialized commit is held through autosave, background and unmount", async () => {
  const account = setup(), gate = held<void>();
  account.holdCommit(gate.promise);
  await mount(Edit);
  await act(async () => renderer!.root.findAll((node) => String(node.type) === "Field" && node.props.label === "Notes")[0].props.onChange("A memory to keep"));
  await press("Save journal entry");
  await act(async () => { await vi.advanceTimersByTimeAsync(450); scope.foreground?.("background"); renderer!.unmount(); });
  renderer = undefined;
  await act(async () => { gate.release(); await gate.promise; await account.drain(); });
  expect(account.state.outbox).toHaveLength(1);
  expect(account.state.drafts).toEqual({});
});
it("resumes draft protection when the save commit fails", async () => {
  const account = setup(); account.commit.mockRejectedValueOnce(Error("Device storage unavailable"));
  await mount(Edit);
  await act(async () => renderer!.root.findAll((node) => String(node.type) === "Field" && node.props.label === "Notes")[0].props.onChange("Keep this after failure"));
  await press("Save journal entry");
  await act(async () => { scope.foreground?.("background"); await account.drain(); });
  expect(account.state.outbox).toHaveLength(0);
  expect(account.state.drafts["new:journal"].body).toBe("Keep this after failure");
  expect(scope.dismiss).not.toHaveBeenCalled();
});
it("reoffers a deferred native share on foreground without immediately repeating Later", async () => {
  setup(); scope.pending.mockResolvedValue(payload()); await mount(ShareCapture);
  await alertPress("Save this shared source?", "Later"); expect(scope.alerts).toHaveLength(1);
  await act(async () => scope.foreground?.("active"));
  expect(scope.alerts.filter((item) => item.title === "Save this shared source?")).toHaveLength(2);
});
it("waits for the newest native payload before reoffering a deferred capture", async () => {
  const account = setup(); scope.pending.mockResolvedValueOnce(payload()); await mount(ShareCapture);
  await alertPress("Save this shared source?", "Later");
  const newer = held<ReturnType<typeof payload>>(); scope.pending.mockReturnValueOnce(newer.promise);
  await act(async () => scope.foreground?.("active")); expect(scope.alerts).toHaveLength(1);
  await act(async () => newer.release(payload("capture-B")));
  await alertPress("Save this shared source?", "Review source");
  expect(Object.keys(account.state.drafts)).toEqual(["share:capture-B"]);
  expect(scope.acknowledge).toHaveBeenCalledWith("capture-B");
});
it("reoffers a stock share on foreground too", async () => {
  setup(); scope.native = false; scope.stock.hasShareIntent = true; scope.stock.shareIntent.text = "A useful tip";
  await mount(ShareCapture); await alertPress("Save this shared source?", "Later");
  await act(async () => scope.foreground?.("active")); expect(scope.alerts).toHaveLength(2);
});
it("keeps supported files and URL/text when another attachment is unsupported", async () => {
  const account = setup(); scope.pending.mockResolvedValueOnce(payload("mixed", [
    { path: "file:///a.zip", fileName: "a.zip", mimeType: "application/zip" },
    { path: "file:///a.png", fileName: "a.png", mimeType: "image/png" },
  ]));
  scope.copy.mockRejectedValueOnce(Object.assign(Error("unsupported"), { code: "unsupported_file" }));
  await mount(ShareCapture); await alertPress("Save this shared source?", "Review source");
  expect(account.state.drafts["share:mixed"]).toMatchObject({ body: "Saved tip", data: { url: "https://example.test/advice" } });
  expect(account.state.drafts["share:mixed"].files).toHaveLength(1);
  expect(scope.alerts.some((item) => item.title === "Some attachments were left out")).toBe(true);
  expect(scope.remove).not.toHaveBeenCalled(); expect(scope.acknowledge).toHaveBeenCalledWith("mixed");
});
it("cleans uncommitted copies on failed draft persistence and lets the same token retry", async () => {
  const account = setup(); scope.pending.mockResolvedValue(payload("failed", [{ path: "file:///a.png", fileName: "a.png", mimeType: "image/png" }]));
  account.saveDraft.mockRejectedValueOnce(Error("Storage full"));
  await mount(ShareCapture); await alertPress("Save this shared source?", "Review source");
  expect(scope.remove).toHaveBeenCalledWith(account.owner, "file:///private/a.png");
  expect(scope.acknowledge).not.toHaveBeenCalled();
  await alertPress("Your share needs another try", "Try again");
  await alertPress("Save this shared source?", "Review source");
  expect(account.state.drafts["share:failed"].files).toHaveLength(1);
});
it("never removes files owned by a saved draft when acknowledgement fails", async () => {
  const account = setup(); scope.pending.mockResolvedValue(payload("saved", [{ path: "file:///a.png", fileName: "a.png", mimeType: "image/png" }]));
  scope.acknowledge.mockImplementationOnce(() => { throw Error("Native bridge unavailable"); });
  await mount(ShareCapture); await alertPress("Save this shared source?", "Review source");
  expect(account.state.drafts["share:saved"].files).toHaveLength(1);
  expect(scope.remove).not.toHaveBeenCalled();
});
it("cleans a late private copy after its account retires without saving or acknowledging", async () => {
  const account = setup(), copying = held<LocalFile>();
  scope.pending.mockResolvedValue(payload("late", [{ path: "file:///a.png", fileName: "a.png", mimeType: "image/png" }]));
  scope.copy.mockReturnValueOnce(copying.promise);
  await mount(ShareCapture); await alertPress("Save this shared source?", "Review source"); account.retire();
  await act(async () => copying.release({ id: "a", uri: "file:///private/a.png", name: "a.png", mime_type: "image/png" }));
  expect(scope.remove).toHaveBeenCalledWith(account.owner, "file:///private/a.png");
  expect(account.saveDraft).not.toHaveBeenCalled(); expect(scope.acknowledge).not.toHaveBeenCalled();
});
it("retains an unsupported-only share rather than acknowledging an empty draft", async () => {
  const account = setup(); scope.pending.mockResolvedValue({ token: "unsupported", url: "", text: "", files: [{ path: "file:///a.zip" }] });
  scope.copy.mockRejectedValue(Object.assign(Error("unsupported"), { code: "unsupported_file" }));
  await mount(ShareCapture); await alertPress("Save this shared source?", "Review source");
  expect(account.saveDraft).not.toHaveBeenCalled(); expect(scope.acknowledge).not.toHaveBeenCalled();
  expect(scope.alerts.at(-1)?.title).toBe("Your share needs another try");
});

it("discards unsupported native input without repeating on foreground or touching saved drafts", async () => {
  const account = setup();
  account.state.drafts["share:unsupported"] = { id: "saved", kind: "source", title: "Keep", body: "", child_id: null, occurred_at: "2026-10-20", data: {}, files: [{ id: "a", uri: "file:///private/a.png", name: "a.png", mime_type: "image/png" }] };
  scope.pending.mockResolvedValue({ token: "unsupported", url: "", text: "", files: [{ path: "file:///a.zip" }] });
  await mount(ShareCapture);
  // The initial prompt can discard even when a previous review already saved a draft.
  scope.pending.mockResolvedValue(null);
  await alertPress("Save this shared source?", "Discard share");
  await act(async () => scope.foreground?.("active"));
  expect(scope.acknowledge).toHaveBeenCalledWith("unsupported");
  expect(scope.alerts.filter((item) => item.title === "Save this shared source?")).toHaveLength(1);
  expect(account.state.drafts["share:unsupported"].files).toHaveLength(1);
  expect(scope.remove).not.toHaveBeenCalled();
});
it("discards an unsupported-only native token from the error without a later foreground prompt", async () => {
  const account = setup(); scope.pending.mockResolvedValue({ token: "unsupported", url: "", text: "", files: [{ path: "file:///a.zip" }] });
  scope.copy.mockRejectedValue(Object.assign(Error("unsupported"), { code: "unsupported_file" }));
  await mount(ShareCapture); await alertPress("Save this shared source?", "Review source");
  scope.pending.mockResolvedValue(null);
  await alertPress("Your share needs another try", "Discard share");
  await act(async () => scope.foreground?.("active"));
  expect(scope.acknowledge).toHaveBeenCalledExactlyOnceWith("unsupported");
  expect(account.saveDraft).not.toHaveBeenCalled(); expect(scope.remove).not.toHaveBeenCalled();
  expect(scope.alerts.filter((item) => item.title === "Save this shared source?")).toHaveLength(1);
});
it.each(["Discard share", "Review source"])("keeps a newer foreground share when an older %s refresh resolves last", async (action) => {
  const account = setup(); scope.pending.mockResolvedValueOnce(payload("capture-A"));
  await mount(ShareCapture);
  const older = held<ReturnType<typeof payload> | null>(), newer = held<ReturnType<typeof payload> | null>();
  scope.pending.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  await alertPress("Save this shared source?", action);
  await act(async () => scope.foreground?.("active"));
  await act(async () => newer.release(payload("capture-B")));
  await act(async () => older.release(null));
  await alertPress("Save this shared source?", "Later");
  // A retained Alert callback alone could still save B after state was erased.
  // Re-entering readiness must offer the still-current payload again, without a native reload.
  account.ready = false;
  await act(async () => renderer!.update(React.createElement(ShareCapture)));
  account.ready = true;
  await act(async () => renderer!.update(React.createElement(ShareCapture)));
  expect(scope.alerts.filter((item) => item.title === "Save this shared source?")).toHaveLength(3);
  await alertPress("Save this shared source?", "Review source");
  expect(account.state.drafts["share:capture-B"]).toBeDefined();
  expect(scope.acknowledge).toHaveBeenLastCalledWith("capture-B");
  expect(scope.remove).not.toHaveBeenCalled();
});
it("offers discard after unsupported-only validation fails and resets stock input too", async () => {
  setup(); scope.native = false; scope.stock.hasShareIntent = true;
  scope.stock.shareIntent.files = [{ path: "file:///a.zip" }];
  scope.copy.mockRejectedValue(Object.assign(Error("unsupported"), { code: "unsupported_file" }));
  scope.reset.mockImplementation(() => { scope.stock.hasShareIntent = false; });
  await mount(ShareCapture); await alertPress("Save this shared source?", "Review source");
  await alertPress("Your share needs another try", "Discard share");
  await act(async () => scope.foreground?.("active"));
  expect(scope.reset).toHaveBeenCalledTimes(1); expect(scope.acknowledge).not.toHaveBeenCalled();
  expect(scope.alerts.filter((item) => item.title === "Save this shared source?")).toHaveLength(1);
});

it("cleans earlier copies if a later supported file fails to copy", async () => {
  const account = setup(); scope.pending.mockResolvedValue(payload("partial", [
    { path: "file:///a.png", fileName: "a.png", mimeType: "image/png" },
    { path: "file:///b.png", fileName: "b.png", mimeType: "image/png" },
  ]));
  scope.copy.mockResolvedValueOnce({ id: "a", uri: "file:///private/a.png", name: "a.png", mime_type: "image/png" })
    .mockRejectedValueOnce(Error("Interrupted native copy"));
  await mount(ShareCapture); await alertPress("Save this shared source?", "Review source");
  expect(scope.remove).toHaveBeenCalledWith(account.owner, "file:///private/a.png");
  expect(account.saveDraft).not.toHaveBeenCalled(); expect(scope.acknowledge).not.toHaveBeenCalled();
});
