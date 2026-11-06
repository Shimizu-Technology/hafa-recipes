import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, type BabyRecord, type DeviceState, type EditorDraft } from "./models";
const scope = vi.hoisted(() => ({
  account: null as any, params: { kind: "journal" } as Record<string, string>, fontScale: 1, dismiss: vi.fn(), toast: vi.fn(),
  sheet: vi.fn(), alerts: [] as { title: string; buttons: { text: string; onPress?: () => void }[] }[],
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" }, View: "View", Image: "Image", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", TextInput: "TextInput", Modal: "Modal",
  ActivityIndicator: "ActivityIndicator", KeyboardAvoidingView: "KeyboardAvoidingView",
  useWindowDimensions: () => ({ fontScale: scope.fontScale }), useColorScheme: () => "dark",
  ActionSheetIOS: { showActionSheetWithOptions: scope.sheet },
  Alert: { alert: (title: string, _message: string, buttons = []) => scope.alerts.push({ title, buttons }) },
  AppState: { addEventListener: () => ({ remove() {} }) },
  Keyboard: { dismiss: vi.fn(), addListener: () => ({ remove() {} }) },
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }) }));
vi.mock("@react-native-community/datetimepicker", () => ({ default: "DateTimePicker" }));
vi.mock("expo-image", () => ({ Image: "ExpoImage" }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => scope.params, Stack: { Screen: () => null }, router: { push: vi.fn(), dismissTo: scope.dismiss, back: vi.fn() } }));
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `fixture-${++id}` }; });
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-image-picker", () => ({}));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/outbox", () => import("./outbox"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/care-glance", () => import("./care-glance"));
vi.mock("@/lib/quick-care", () => import("./quick-care"));
vi.mock("@/lib/events", () => import("./events"));
vi.mock("@/lib/visits", () => import("./visits"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/files", () => ({ preserveFile: vi.fn(), removeLocal: vi.fn() }));
vi.mock("@/lib/reminders", () => ({ requestReminders: vi.fn() }));
vi.mock("@/components/date-field", () => ({ DateField: "DateField" }));
vi.mock("../components/date-field", () => ({ DateField: "DateField" }));
vi.mock("./date-field", () => ({ DateField: "DateField" }));
vi.mock("@/components/event-fields", () => ({ EventFields: "EventFields" }));
vi.mock("@/components/collection-sources", () => ({ CollectionSources: "CollectionSources" }));
vi.mock("../components/log-fields", () => ({ LogFields: "LogFields" }));
vi.mock("../lib/use-open-journal", () => ({ useOpenJournal: () => vi.fn() }));
const ui = vi.hoisted(() => ({
  Button: "Button", Card: "Card", Chips: "Chips", Choice: "Choice", Copy: "Copy", Field: "Field", Icon: "Icon", Loading: "Loading", Notice: "Notice", PressTarget: "PressTarget",
  Screen: "Screen", Section: "Section", TopBar: ({ trailing }: { trailing: unknown }) => trailing, fonts: {}, radii: {}, sectionHeadingLimit: 2.2, typeScale: { title1: {}, caption: {} },
  useColors: () => ({ accentText: "clay", muted: "muted", text: "text", background: "ground", soft: "soft", border: "line", action: "cocoa", onAction: "sand", scrim: "scrim" }),
  useToast: () => scope.toast,
}));
vi.mock("@/components/ui", () => ui);
vi.mock("../components/ui", () => ui);
vi.mock("./ui", () => ui);
import Edit from "../app/edit";
import { doctorNote, doctorNoteTitle } from "./contractions";

let renderer: ReactTestRenderer | undefined;
const entry = (over: Partial<BabyRecord> = {}): BabyRecord => ({ id: "old", kind: "journal", title: "First day felt good", body: "First day felt good", child_id: null,
  occurred_at: "2026-11-04T09:52:00.000Z", data: {}, revision: 2, created_at: "", updated_at: "", ...over } as BabyRecord);
function setup(records: BabyRecord[] = [], drafts: Record<string, EditorDraft> = {}, children: { id: string; name: string; revision: number }[] = []) {
  let writes = Promise.resolve();
  const account: any = {
    owner: "parent", online: true, records, current: () => true, sync: vi.fn(),
    state: { ...emptyState(), records, drafts, bootstrap: { generation: 1, active: true, ai_available: false, children, profile: { ai_consent: false, timezone: "Pacific/Guam", display_name: "Kai" } } } as DeviceState,
    api: { record: vi.fn(async (id: string) => records.find((row) => row.id === id)) },
    commit: vi.fn((update: (state: DeviceState) => DeviceState) => { writes = writes.then(() => { account.state = update(account.state); }); return writes; }),
    saveDraft: vi.fn((key: string, draft: EditorDraft | null) => { writes = writes.then(() => {
      const next = { ...account.state.drafts }; if (draft) next[key] = draft; else delete next[key];
      account.state = { ...account.state, drafts: next };
    }); return writes; }),
    drain: () => writes,
  };
  scope.account = account;
  return account;
}
const input = (label: string) => renderer!.root.findAll((node) => String(node.type) === "TextInput" && node.props.accessibilityLabel === label)[0];
const control = (label: string) => renderer!.root.findAll((node) => (String(node.type) === "PressTarget" || String(node.type) === "Pressable") && node.props.accessibilityLabel === label)[0];
const texts = () => renderer!.root.findAll((node) => String(node.type) === "Text").map((node) => node.props.children);
async function open() { await act(async () => { renderer = TestRenderer.create(<Edit />); }); }
async function type(label: string, text: string) { await act(async () => input(label).props.onChangeText(text)); }
async function save(account: any) {
  await act(async () => control(account.state.drafts && scope.params.id ? "Save changes" : "Save journal entry").props.onPress());
  await act(async () => { await account.drain(); });
  return account.state.outbox.at(-1)?.record;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); scope.params = { kind: "journal" }; scope.fontScale = 1; scope.alerts = [];
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); });

it("opens a new entry as a page: title first, then the body with the keyboard already there", async () => {
  setup();
  await open();
  const inputs = renderer!.root.findAll((node) => String(node.type) === "TextInput");
  expect(inputs.map((node) => node.props.accessibilityLabel)).toEqual(["Title, optional", "Your entry"]);
  expect(input("Your entry").props.autoFocus).toBe(true);
  expect(input("Title, optional").props).toMatchObject({ placeholder: "Title (optional)", returnKeyType: "next", submitBehavior: "submit" });
  expect(input("Title, optional").props.style.borderWidth).toBeUndefined();
  expect(input("Your entry").props.selectionColor).toBe("clay");
  // Nothing to say yet, so nothing sits in the top bar to tap.
  expect(renderer!.root.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Details")).toHaveLength(0);
});
it("stores no title of its own for an entry she didn't title, so nothing can go stale", async () => {
  const account = setup();
  await open();
  await type("Your entry", "Felt the first real kick tonight\nRight after dinner");
  const record = await save(account);
  expect(record).toMatchObject({ title: "Journal entry", body: "Felt the first real kick tonight\nRight after dinner" });
  expect(scope.dismiss).toHaveBeenCalledWith({ pathname: "/record/[id]", params: { id: record.id } });
});
it("keeps a title she typed, and turns a pasted line break into a space", async () => {
  const account = setup();
  await open();
  await type("Title, optional", "First\nkick");
  expect(input("Title, optional").props.value).toBe("First kick");
  await type("Your entry", "After dinner");
  expect((await save(account)).title).toBe("First kick");
});
it("doesn't show the same words twice, whether the title was typed or an older build's cut", async () => {
  const long = "We went for a walk this morning, and the whole neighbourhood stopped to say hello";
  for (const row of [entry(), entry({ title: long.slice(0, 59) + "…", body: long }), entry({ title: "FIRST KICK!", body: "First kick." }), entry({ title: "Journal entry", body: "Something" })]) {
    setup([row]);
    scope.params = { id: row.id };
    await open();
    expect(input("Title, optional").props.value).toBe("");
    expect(input("Your entry").props.value).toBe(row.body);
    expect(input("Your entry").props.autoFocus).toBe(false);
    await act(async () => renderer!.unmount());
  }
  renderer = undefined;
});
it("never rewrites a title because the body changed: first reproduction", async () => {
  const account = setup([entry({ title: "First kick", body: "First kick" })]);
  scope.params = { id: "old" };
  await open();
  expect(input("Title, optional").props.value).toBe("");
  await type("Your entry", "Second kick");
  expect(await save(account)).toMatchObject({ title: "First kick", body: "Second kick", revision: 2 });
});
it("sends a title with different case and punctuation back exactly as stored, with no body change", async () => {
  const account = setup([entry({ title: "FIRST KICK!", body: "First kick." })]);
  scope.params = { id: "old" };
  await open();
  expect((await save(account)).title).toBe("FIRST KICK!");
});
it("keeps a chosen ellipsis title, even over a long line it opens", async () => {
  const body = "Our first Christmas together with everyone at grandma's house and the whole street singing";
  for (const title of ["Our first Christmas together…", "  Spaced as it was  "]) {
    const account = setup([entry({ title, body })]);
    scope.params = { id: "old" };
    await open();
    expect((await save(account)).title).toBe(title);
    await act(async () => renderer!.unmount());
  }
  renderer = undefined;
});
it("keeps the timer's doctor note findable after its opening is edited in Journal", async () => {
  const note = entry({ title: doctorNoteTitle, body: "What my doctor told me is to rest", child_id: "baby", data: { provenance: "clinician_instruction" } });
  const account = setup([note], {}, [{ id: "baby", name: "Mia", revision: 1 }]);
  scope.params = { id: "old" };
  await open();
  expect(input("Title, optional").props.value).toBe(doctorNoteTitle);
  await type("Your entry", "Rest and fluids");
  const record = await save(account);
  expect(record.title).toBe(doctorNoteTitle);
  expect(doctorNote([{ ...note, ...record }], "baby")?.body).toBe("Rest and fluids");
  // And when the body is word for word its title, so the page hides it.
  const same = entry({ title: doctorNoteTitle, body: doctorNoteTitle, child_id: "baby", data: { provenance: "clinician_instruction" } });
  await act(async () => renderer!.unmount());
  const second = setup([same], {}, [{ id: "baby", name: "Mia", revision: 1 }]);
  await open();
  expect(input("Title, optional").props.value).toBe("");
  await type("Your entry", "Now different");
  const kept = await save(second);
  expect(doctorNote([{ ...same, ...kept }], "baby")?.body).toBe("Now different");
});
it("changes a stored title only when she does", async () => {
  // Typing into the blank box replaces it.
  let account = setup([entry({ title: "First kick", body: "First kick" })]);
  scope.params = { id: "old" };
  await open();
  await type("Title, optional", "The real one");
  expect((await save(account)).title).toBe("The real one");
  await act(async () => renderer!.unmount());
  // Clearing a title she can see leaves the entry with none, which is stored as the kind's name.
  account = setup([entry({ title: "A real title", body: "Other words" })]);
  await open();
  expect(input("Title, optional").props.value).toBe("A real title");
  await type("Title, optional", "");
  expect((await save(account)).title).toBe("Journal entry");
  await act(async () => renderer!.unmount());
  // An old title stays and shows once the body has moved on from it: she can see it and change it.
  account = setup([entry({ title: "First day felt good", body: "Today was hard" })]);
  await open();
  expect(input("Title, optional").props.value).toBe("First day felt good");
  expect((await save(account)).title).toBe("First day felt good");
  renderer!.unmount();
  renderer = undefined;
});
it("keeps a title-only draft called Journal entry through cleanup, and shows it", async () => {
  const draft: EditorDraft = { id: "new-2", kind: "journal", title: "Journal entry", body: "", child_id: null, occurred_at: "2026-11-04T09:52:00.000Z", data: {}, files: [] };
  const account = setup([], { "new:journal": draft });
  await open();
  expect(input("Title, optional").props.value).toBe("Journal entry");
  await act(async () => { await vi.advanceTimersByTimeAsync(500); renderer!.unmount(); await account.drain(); });
  renderer = undefined;
  expect(account.state.drafts["new:journal"].title).toBe("Journal entry");
  await open();
  expect((await save(account)).title).toBe("Journal entry");
});
it("keeps the raw title in a draft while the box is blank", async () => {
  const account = setup([entry({ title: "First kick", body: "First kick" })]);
  scope.params = { id: "old" };
  await open();
  await type("Your entry", "First kick and more");
  await act(async () => { await vi.advanceTimersByTimeAsync(500); renderer!.unmount(); await account.drain(); });
  renderer = undefined;
  expect(account.state.drafts["record:old"].title).toBe("First kick");
  await open();
  expect(input("Title, optional").props.value).toBe("");
  expect((await save(account)).title).toBe("First kick");
});
it("keeps every pasted word, says what's over, and doesn't save until it fits", async () => {
  const account = setup();
  await open();
  expect(input("Your entry").props.maxLength).toBeUndefined();
  expect(input("Title, optional").props.maxLength).toBeUndefined();
  const long = "a".repeat(100001);
  await type("Your entry", long);
  expect(input("Your entry").props.value).toBe(long);
  const notice = () => renderer!.root.findAll((node) => String(node.type) === "Notice").map((node) => node.props.children);
  expect(notice()).toEqual(["This entry is 1 character too long to save. Nothing has been cut. Shorten it to save."]);
  await save(account);
  expect(account.state.outbox).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(500); await account.drain(); });
  expect(account.state.drafts["new:journal"].body).toBe(long);
  // 60,000 emoji are 120,000 to iOS and 60,000 to the API.
  await type("Your entry", "😀".repeat(60000));
  expect(notice()).toEqual([]);
  await type("Title, optional", "x".repeat(241));
  expect(notice()).toEqual(["This title is 1 character too long to save. Nothing has been cut. Shorten it to save."]);
  await type("Title, optional", "x".repeat(240));
  expect((await save(account))).toMatchObject({ title: "x".repeat(240) });
});
it("opens an older build's draft without the first-line title, even after the body moved on", async () => {
  const draft: EditorDraft = { ...entry(), body: "First day felt good and then some", files: [], existing: true, base: { after: [] } };
  setup([entry()], { "record:old": draft });
  scope.params = { id: "old" };
  await open();
  expect(input("Title, optional").props.value).toBe("");
  expect(input("Your entry").props.value).toBe("First day felt good and then some");
});
it("doesn't leave an unfinished draft behind when an entry was only opened", async () => {
  const account = setup([entry()]);
  scope.params = { id: "old" };
  await open();
  await act(async () => { await vi.advanceTimersByTimeAsync(500); renderer!.unmount(); await account.drain(); });
  renderer = undefined;
  expect(account.state.drafts).toEqual({});
  await open();
  await type("Your entry", "Changed");
  await act(async () => { await vi.advanceTimersByTimeAsync(500); renderer!.unmount(); await account.drain(); });
  renderer = undefined;
  expect(account.state.drafts["record:old"].body).toBe("Changed");
  // And coming back to it without touching it keeps it.
  await open();
  await act(async () => { await vi.advanceTimersByTimeAsync(500); renderer!.unmount(); await account.drain(); });
  renderer = undefined;
  expect(account.state.drafts["record:old"].body).toBe("Changed");
});
it("keeps a draft's own title through coming back to it offline", async () => {
  const draft: EditorDraft = { id: "new-1", kind: "journal", title: "Hospital bag", body: "Socks", child_id: null, occurred_at: "2026-11-04T09:52:00.000Z", data: {}, files: [] };
  const account = setup([], { "new:journal": draft });
  account.online = false;
  await open();
  expect(input("Title, optional").props.value).toBe("Hospital bag");
  expect(input("Your entry").props.autoFocus).toBe(true);
  expect((await save(account)).title).toBe("Hospital bag");
  expect(scope.toast).toHaveBeenCalledWith("Saved privately on this device.", expect.objectContaining({ label: "See journal" }));
});
it("says what's missing, right by Save, when there's nothing to keep", async () => {
  const account = setup();
  await open();
  await save(account);
  expect(account.state.outbox).toHaveLength(0);
  expect(renderer!.root.findAll((node) => String(node.type) === "Notice")[0].props.children).toBe("Write something or add a photo to keep.");
});
it("tucks the rest away, and only offers Discard once there's something to throw away", async () => {
  setup([], {}, [{ id: "baby", name: "Mia", revision: 1 }]);
  await open();
  expect(renderer!.root.findAll((node) => String(node.type) === "Choice")).toHaveLength(0);
  await act(async () => control("Details").props.onPress());
  expect(renderer!.root.findAll((node) => String(node.type) === "Choice").map((node) => node.props.label)).toContain("My clinician told me this");
  expect(renderer!.root.findAll((node) => String(node.type) === "Chips")).toHaveLength(1);
  const buttons = () => renderer!.root.findAll((node) => String(node.type) === "Button").map((node) => node.props.title);
  expect(buttons()).not.toContain("Discard this draft");
  await type("Your entry", "Something");
  expect(buttons()).toContain("Discard this draft");
  await act(async () => renderer!.root.findAll((node) => String(node.type) === "Button" && node.props.title === "Discard this draft")[0].props.onPress());
  expect(scope.alerts.at(-1)?.title).toBe("Discard this draft?");
});
it("offers the photo, camera and file through one small control", async () => {
  setup();
  await open();
  await act(async () => control("Add a photo or file").props.onPress());
  expect(scope.sheet.mock.calls[0][0].options).toEqual(["Cancel", "Photo library", "Take a photo", "Choose a file"]);
});
it("shows a photo once, however far along its upload is, from the copy on this phone, and removing it lets go of its upload", async () => {
  const file = { id: "f1", uri: "file:///a.jpg", name: "a.jpg", mime_type: "image/jpeg", uploaded_id: "up-1" };
  const draft: EditorDraft = { ...entry({ data: { attachment_ids: ["up-1", "up-2"] } }), files: [file], existing: true };
  const account = setup([entry()], { "record:old": draft });
  account.api.attachment = vi.fn(() => new Promise(() => undefined));
  scope.params = { id: "old" };
  await open();
  expect(control("Add a photo or file. 2 added.")).toBeDefined();
  expect(account.api.attachment).toHaveBeenCalledTimes(1);
  expect(account.api.attachment).toHaveBeenCalledWith("up-2");
  await act(async () => control("Remove a.jpg").props.onPress());
  await act(async () => { await vi.advanceTimersByTimeAsync(500); await account.drain(); });
  expect(account.state.drafts["record:old"]).toMatchObject({ files: [], data: { attachment_ids: ["up-2"] } });
  await act(async () => control("Remove saved attachment 1").props.onPress());
  await act(async () => { await vi.advanceTimersByTimeAsync(500); await account.drain(); });
  expect(account.state.drafts["record:old"].data.attachment_ids).toEqual([]);
});
it("refuses to keep an entry with nothing in it, even with the kind's name stored", async () => {
  const account = setup([entry({ title: "Journal entry", body: "Something" })]);
  scope.params = { id: "old" };
  await open();
  await type("Your entry", "");
  await save(account);
  expect(account.state.outbox).toHaveLength(0);
  expect(renderer!.root.findAll((node) => String(node.type) === "Notice")[0].props.children).toBe("Write something or add a photo to keep.");
  await type("Your entry", "Back");
  expect(renderer!.root.findAll((node) => String(node.type) === "Notice")).toHaveLength(0);
});
it("still saves a photo-only entry whose title was only the kind's name", async () => {
  const account = setup([entry({ title: "Journal entry", body: "", data: { attachment_ids: ["up-1"] } })]);
  account.api.attachment = vi.fn(() => new Promise(() => undefined));
  scope.params = { id: "old" };
  await open();
  expect(input("Title, optional").props.value).toBe("");
  expect((await save(account)).title).toBe("Journal entry");
});
it("keeps every control reachable at the largest text, with the date moved into a labelled calendar", async () => {
  setup();
  await open();
  expect(texts().join(" ")).toContain("Save");
  await act(async () => renderer!.unmount());
  scope.fontScale = 3.1;
  await open();
  const when = renderer!.root.findAll((node) => String(node.type) === "PressTarget" && String(node.props.accessibilityLabel).startsWith("Date and time"));
  expect(when).toHaveLength(1);
  expect(when[0].props.style.width).toBe(44);
  expect(input("Title, optional").props.maxFontSizeMultiplier).toBe(1.6);
  expect(input("Your entry").props.maxFontSizeMultiplier).toBe(0);
  expect(control("Save journal entry")).toBeDefined();
  expect(control("Details")).toBeDefined();
});
it("says who can see it without opening anything, for a parent in a family, and a new entry starts private", async () => {
  const account = setup();
  account.state.bootstrap = { ...account.state.bootstrap, personal_space_id: "me", spaces: [
    { id: "me", kind: "personal", role: "owner", generation: 1 }, { id: "fam", kind: "family", role: "parent", generation: 1 }] };
  await open();
  expect(texts().flat()).toContain("Just me");
  await act(async () => control("Just me. Details").props.onPress());
  await act(async () => renderer!.root.findAll((node) => String(node.type) === "Choice" && node.props.label === "Shared with family")[0].props.onPress());
  expect(texts().flat()).toContain("Shared");
  expect(texts().flat()).not.toContain("Just me");
});
it("trusts the saved row over a draft kept from before the entry moved", async () => {
  const account = setup([entry({ space_id: "fam" })], { "record:old": { ...entry({ space_id: "me" }), files: [], existing: true } });
  account.state.bootstrap = { ...account.state.bootstrap, personal_space_id: "me", spaces: [
    { id: "me", kind: "personal", role: "owner", generation: 1 }, { id: "fam", kind: "family", role: "parent", generation: 1 }] };
  scope.params = { id: "old" };
  await open();
  expect(texts().flat()).toContain("Shared");
});
it("says who can see a saved entry too, even one only just fetched, and where a new one goes", async () => {
  const account = setup([], { "record:old": { ...entry({ space_id: "fam" }), files: [], existing: true } });
  account.state.bootstrap = { ...account.state.bootstrap, personal_space_id: "me", spaces: [
    { id: "me", kind: "personal", role: "owner", generation: 1 }, { id: "fam", kind: "family", role: "parent", generation: 1 }] };
  scope.params = { id: "old" };
  await open();
  expect(texts().flat()).toContain("Shared");
  await act(async () => renderer!.unmount());
  scope.params = { kind: "journal" };
  setup();
  await open();
  await act(async () => control("Details").props.onPress());
  expect(renderer!.root.findAll((node) => String(node.type) === "Copy").map((node) => node.props.children)).toContain("Goes in your Journal. Only you can see it.");
});
