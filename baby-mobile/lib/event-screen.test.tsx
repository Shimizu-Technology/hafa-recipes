import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type EditorDraft, type Mutation } from "./models";

const mock = vi.hoisted(() => ({ phone: { available: true, added: [] as unknown[], result: "saved" }, title: "" as string | undefined, upcoming: { items: [] as any[] }, baby: null as any, params: {} as Record<string, string>, push: vi.fn(), back: vi.fn(), dismissTo: vi.fn(), toast: vi.fn(), alerts: [] as any[], ids: 0 }));
vi.mock("react-native", () => ({ View: "View", Image: "Image", Text: "Text", Pressable: "Pressable", useWindowDimensions: () => ({ fontScale: 1 }), Alert: { alert: (...args: unknown[]) => mock.alerts.push(args) }, AppState: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: "ios" } }));
vi.mock("expo-router", () => ({ useNavigationContainerRef: () => ({ getRootState: () => undefined }), useLocalSearchParams: () => mock.params, router: { push: mock.push, back: mock.back, dismissTo: mock.dismissTo } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `uuid-${++mock.ids}` }));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-image-picker", () => ({}));
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
vi.mock("@/lib/events", () => import("./events"));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/outbox", () => import("./outbox"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/care-glance", () => import("./care-glance"));
vi.mock("@/lib/quick-care", () => import("./quick-care"));
vi.mock("@/lib/files", () => ({ preserveFile: vi.fn(), removeLocal: vi.fn() }));
vi.mock("@/lib/reminders", () => ({ requestReminders: vi.fn() }));
vi.mock("@/components/collection-sources", () => ({ CollectionSources: "CollectionSources" }));
vi.mock("../components/journal-composer", () => ({ JournalComposer: "JournalComposer", ComposerOpening: "ComposerOpening" }));
vi.mock("@/components/date-field", () => ({ DateField: "DateField" }));
vi.mock("@/components/event-row", () => ({ CategoryTile: "CategoryTile", openEvent: vi.fn() }));
vi.mock("@/components/visit-sections", () => ({ VisitSections: "VisitSections", VisitLinks: "VisitLinks", EventNotes: "EventNotes" }));
vi.mock("@/lib/use-events", () => ({ useUpcomingEvents: () => mock.upcoming }));
vi.mock("@/lib/visits", () => import("./visits"));
vi.mock("@/lib/phone-calendar", () => ({ phoneCalendarAvailable: () => mock.phone.available, phoneEvent: () => ({ title: "from-helper" }), phoneEventLine: () => "Only the title, time and place are copied.", addToPhoneCalendar: async (event: unknown) => { mock.phone.added.push(event); return mock.phone.result; } }));
vi.mock("@/components/event-fields", () => import("../components/event-fields"));
const ui = vi.hoisted(() => ({ fonts: {}, typeScale: {}, tap: () => undefined, FilterChips: "FilterChips", Icon: "Icon", PressTarget: "PressTarget", Button: "Button", Card: "Card", Chips: "Chips", Choice: "Choice", Copy: "Copy", Field: "Field", Grouped: "Grouped", Loading: "Loading", Notice: "Notice", Row: "Row", Section: "Section",
  Screen: ({ children, footer, title }: { children: unknown; footer?: unknown; title?: string }) => { mock.title = title; return [children, footer]; }, useToast: () => mock.toast, useColors: () => ({ categories: {} }) }));
vi.mock("@/components/ui", () => ui);
vi.mock("../components/ui", () => ui);
vi.mock("../components/date-field", () => ({ DateField: "DateField" }));
import EventDetail from "../app/event/[id]";
import Edit from "../app/edit";

const guam = "Pacific/Guam";
let renderer: ReactTestRenderer | undefined;
function setup(records: BabyRecord[], online = true) {
  const account: any = {
    owner: "o", online, state: { ...emptyState(), records, bootstrap: { generation: 1, active: true, ai_available: false, children: [{ id: "baby", name: "Noa", revision: 1 }], profile: { display_name: "", timezone: guam, ai_consent: false } } } as DeviceState,
    get records() { return account.state.records; }, current: () => true, sync: vi.fn(), api: { record: vi.fn() },
    commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { account.state = change(account.state); }),
    queue: vi.fn(async (change: Mutation) => { account.state = { ...account.state, outbox: [...account.state.outbox, change] }; }),
    saveDraft: vi.fn(async (key: string, draft: EditorDraft | null) => { const drafts = { ...account.state.drafts }; if (draft) drafts[key] = draft; else delete drafts[key]; account.state = { ...account.state, drafts }; }),
  };
  mock.baby = account;
  return account;
}
const event = (extra: Partial<BabyRecord["data"]> = {}, id = "class") => ({ ...optimisticRecord({ id, kind: "event", title: "Class", body: "", child_id: null, occurred_at: "2026-11-02T00:00:00.000Z", data: { timezone: guam, recurrence: { frequency: "weekly" }, reminder_minutes: [60], ...extra } }), revision: 4 });
const found = (type: string, match: (props: any) => boolean) => renderer!.root.findAll((n) => String(n.type) === type && match(n.props))[0];
async function mount(component: React.ComponentType) { await act(async () => { renderer = create(React.createElement(component)); }); }
const press = (type: string, title: string) => act(async () => { await found(type, (p) => p.title === title).props.onPress(); });
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(console, "error").mockImplementation(() => undefined); vi.clearAllMocks(); mock.alerts = []; mock.ids = 0; });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("asks which dates an edit to a repeating event reaches, in plain words, before opening the editor", async () => {
  setup([event()]);
  mock.params = { id: "class", at: "2026-11-16T00:00:00.000Z" };
  await mount(EventDetail);
  expect(mock.push).not.toHaveBeenCalled();
  await press("Button", "Edit event");
  expect(mock.push).not.toHaveBeenCalled();
  const one = found("Row", (p) => p.title === "Just this one"), future = found("Row", (p) => p.title === "All future");
  expect(one.props.detail).toMatch(/^Changes .*Nov 16 only\. The other dates stay as they are\.$/);
  expect(future.props.detail).toMatch(/^Changes .*Nov 16 and every date after it\. Earlier dates stay as they are\.$/);
  await press("Row", "All future");
  expect(mock.push).toHaveBeenCalledWith({ pathname: "/edit", params: { kind: "event", id: "class", scope: "future", at: "2026-11-16T00:00:00.000Z" } });
});
it("goes straight to the editor for an event that doesn't repeat", async () => {
  setup([event({ recurrence: null })]);
  mock.params = { id: "class" };
  await mount(EventDetail);
  await press("Button", "Edit event");
  expect(mock.push).toHaveBeenCalledWith({ pathname: "/edit", params: { kind: "event", id: "class" } });
});
it("takes one date off, keeping everything else the event holds, through the outbox", async () => {
  const b = setup([event()]);
  mock.params = { id: "class", at: "2026-11-09T00:00:00.000Z" };
  await mount(EventDetail);
  await press("Button", "Delete event");
  await press("Row", "Just this one");
  const [change] = b.state.outbox;
  expect(change).toMatchObject({ type: "save", record: { id: "class", revision: 4, data: { reminder_minutes: [60], exceptions: [{ original_start: "2026-11-09T00:00:00.000Z", cancelled: true, overrides: null }] } } });
  expect(mock.back).toHaveBeenCalled();
});
it("deletes the event when all future starts from its first date, and ends it from a later one", async () => {
  const b = setup([event()]);
  mock.params = { id: "class", at: "2026-11-02T00:00:00.000Z" };
  await mount(EventDetail);
  await press("Button", "Delete event");
  await press("Row", "All future");
  expect(b.state.outbox[0].type).toBe("delete");
  await act(async () => renderer!.unmount());
  const again = setup([event()]);
  mock.params = { id: "class", at: "2026-11-16T00:00:00.000Z" };
  await mount(EventDetail);
  await press("Button", "Delete event");
  await press("Row", "All future");
  expect(again.state.outbox[0]).toMatchObject({ type: "save", record: { data: { recurrence: { until: "2026-11-15" }, reminder_minutes: [60] } } });
});
it("adds Baptism with a tap on its kind and Save, with no signal, and queues it through the outbox", async () => {
  const b = setup([], false);
  mock.params = { kind: "event", day: "2026-12-20" };
  await mount(Edit);
  await act(async () => { found("FilterChips", (p) => p.label === "Suggestions").props.onChange("Baptism"); });
  await press("Button", "Save event");
  expect(b.state.outbox).toHaveLength(1);
  expect(b.state.outbox[0]).toMatchObject({ type: "save", record: { kind: "event", title: "Baptism", child_id: null, occurred_at: "2026-12-19T14:00:00.000Z", data: { all_day: true, category: "celebration", timezone: guam } } });
  expect(b.state.outbox[0].record.revision).toBeFalsy();
  expect(b.state.drafts).toEqual({});
  expect(mock.toast.mock.calls[0][0]).toMatch(/^Baptism saved for .*Dec 20/);
  expect(mock.back).toHaveBeenCalled();
});
it("won't save an event with no name, and says so where she can see it", async () => {
  const b = setup([]);
  mock.params = { kind: "event", day: "2026-12-20" };
  await mount(Edit);
  await press("Button", "Save event");
  expect(b.state.outbox).toEqual([]);
  expect(mock.toast).toHaveBeenCalledWith("Give this event a name.");
});
it("says plainly when a new repeat would go over the limit, before she leaves the form", async () => {
  const rows = Array.from({ length: 200 }, (_, n) => event({}, `s${n}`)), b = setup(rows);
  mock.params = { kind: "event", day: "2026-12-20" };
  await mount(Edit);
  await act(async () => { found("FilterChips", (p) => p.label === "Suggestions").props.onChange("Birthday"); });
  await press("Button", "Save event");
  expect(b.state.outbox).toEqual([]);
  expect(mock.toast.mock.calls[0][0]).toContain("You can keep up to 200 repeating events.");
});
it("All future from a later date queues one change that holds both parts, so neither can land alone", async () => {
  const b = setup([event()]);
  mock.params = { kind: "event", id: "class", scope: "future", at: "2026-11-16T00:00:00.000Z" };
  await mount(Edit);
  await act(async () => { found("Field", (p) => p.label === "Name").props.onChange("New class"); });
  const writes = b.commit.mock.calls.length;
  await press("Button", "Save changes");
  expect(b.commit.mock.calls.length).toBe(writes + 1);
  expect(b.state.outbox).toHaveLength(1);
  const [split] = b.state.outbox as any[];
  expect(split).toMatchObject({ type: "event_split", from_start: "2026-11-16T00:00:00.000Z", series: { id: "class", revision: 4, title: "Class", data: { recurrence: { until: "2026-11-15" }, reminder_minutes: [60] } }, event: { title: "New class", occurred_at: "2026-11-16T00:00:00.000Z", data: { reminder_minutes: [60] } } });
  expect(split.id).toBe(split.event.id);
  expect(split.event.data.recurrence.until).toBeUndefined();
  expect(mock.dismissTo).toHaveBeenCalledWith("/(tabs)/tracker");
});
it("All future sends both parts with the baby it shows, when a held draft has one that can't go with the family's event", async () => {
  const b = setup([{ ...event(), child_id: "ours", space_id: "fam" }]);
  Object.assign(b.state.bootstrap, { personal_space_id: "mine", spaces: [{ id: "mine", kind: "personal", role: "parent", generation: 1, access_version: 1 }, { id: "fam", kind: "family", role: "parent", generation: 1, access_version: 1 }],
    children: [{ id: "ours", name: "Noa", revision: 1, space_id: "fam", generation: 1 }, { id: "test", name: "Test", revision: 1, space_id: "mine", generation: 1 }] });
  mock.params = { kind: "event", id: "class", scope: "future", at: "2026-11-16T00:00:00.000Z" };
  await mount(Edit);
  await act(async () => { found("FilterChips", (p) => p.label === "Who is it for?").props.onChange("test"); });
  expect(found("FilterChips", (p) => p.label === "Who is it for?").props.value).toBe("ours");
  await press("Button", "Save changes");
  const [split] = b.state.outbox as any[];
  expect(split.type).toBe("event_split");
  expect(split.series.child_id).toBe("ours");
  expect(split.event.child_id).toBe("ours");
});
const savedFor = async (child: string) => {
  const b = setup([]);
  Object.assign(b.state.bootstrap, { children: [{ id: "baby", name: "Noa", revision: 1 }, { id: "sister", name: "Mia", revision: 1 }] });
  b.state.selectedChild = "baby";
  mock.params = { kind: "event", day: "2026-12-20", child };
  await mount(Edit);
  await act(async () => { found("FilterChips", (p) => p.label === "Suggestions").props.onChange("Baptism"); });
  await press("Button", "Save event");
  return b.state.outbox[0].record.child_id;
};
it("adding from a day that shows one baby is for that baby, whichever is selected", async () => {
  expect(await savedFor("sister")).toBe("sister");
});
it("ignores a baby in the link who isn't on this account", async () => {
  expect(await savedFor("gone")).toBe("baby");
});
it("All future can't start before the date it changes from, which the old series keeps", async () => {
  const b = setup([event()]);
  mock.params = { kind: "event", id: "class", scope: "future", at: "2026-11-16T00:00:00.000Z" };
  await mount(Edit);
  await act(async () => { found("DateField", (p) => p.label === "When").props.onChange("2026-11-09T00:00:00.000Z"); });
  await press("Button", "Save changes");
  expect(b.state.outbox).toEqual([]);
  expect(mock.toast.mock.calls[0][0]).toContain("can’t start before the date you’re changing");
});
it("edits just one date as a change on the series, and offers only what one date can hold", async () => {
  const b = setup([event()]);
  mock.params = { kind: "event", id: "class", scope: "one", at: "2026-11-09T00:00:00.000Z" };
  await mount(Edit);
  expect(renderer!.root.findAll((n) => String(n.type) === "FilterChips").map((n) => n.props.label)).toEqual(["Category"]);
  await act(async () => { found("Field", (p) => p.label === "Location (optional)").props.onChange("Clinic"); });
  await press("Button", "Save changes");
  expect(b.state.outbox[0]).toMatchObject({ record: { title: "Class", occurred_at: "2026-11-02T00:00:00.000Z", revision: 4, data: { reminder_minutes: [60], exceptions: [{ original_start: "2026-11-09T00:00:00.000Z", cancelled: false, overrides: { location: "Clinic" } }] } } });
});

const visit = (extra: Partial<BabyRecord["data"]> = {}) => ({ ...event({ recurrence: null, category: "appointment", location: "Clinic", end: "2026-11-02T00:30:00.000Z", ...extra }), title: "OB visit" });
it("shows an appointment's visit sections and Book next, and leaves other events alone", async () => {
  setup([visit()]);
  mock.params = { id: "class" };
  await mount(EventDetail);
  expect(renderer!.root.findAll((n) => String(n.type) === "VisitSections")).toHaveLength(1);
  await press("Button", "Book next");
  expect(mock.push).toHaveBeenCalledWith({ pathname: "/edit", params: { kind: "event", from: "class", at: "2026-11-02T00:00:00.000Z" } });
  await act(async () => renderer!.unmount());
  setup([event({ recurrence: null, category: "family" })]);
  await mount(EventDetail);
  expect(renderer!.root.findAll((n) => String(n.type) === "VisitSections")).toHaveLength(0);
  expect(renderer!.root.findAll((n) => n.props.title === "Book next")).toHaveLength(0);
});
it("tells her what stays when she deletes an appointment", async () => {
  setup([visit()]);
  mock.params = { id: "class" };
  await mount(EventDetail);
  await press("Button", "Delete event");
  expect(mock.alerts[0][1]).toContain("Its questions and notes stay in your Journal.");
});
it("shows the next visit she's already booked", async () => {
  setup([visit()]);
  mock.params = { id: "class" };
  const later = { event_id: "next", original_start: "2026-11-16T00:00:00.000Z", occurrence_start: "2026-11-16T00:00:00.000Z", occurrence_end: null, all_day: false, timezone: guam, title: "OB visit", category: "appointment", location: null, attendees: [], child_id: null, repeats: false, changed: false, revision: 1 };
  mock.upcoming = { items: [later] };
  await mount(EventDetail);
  expect(found("Row", (p) => p.title === "Next visit").props.detail).toContain("Nov 16");
  mock.upcoming = { items: [] };
});
it("Book next opens a form already filled in, and saves a new visit through the outbox, offline too", async () => {
  const b = setup([visit()], false);
  mock.params = { kind: "event", from: "class", at: "2026-11-02T00:00:00.000Z" };
  await mount(Edit);
  expect(renderer!.root.findAll((n) => n.props.label === "Suggestions")).toHaveLength(0);
  await press("Button", "Save next visit");
  const [change] = b.state.outbox;
  expect(change).toMatchObject({ type: "save", record: { kind: "event", title: "OB visit", occurred_at: "2026-11-16T00:00:00.000Z", child_id: null,
    data: { category: "appointment", location: "Clinic", reminder_minutes: [60], end: "2026-11-16T00:30:00.000Z" } } });
  expect(change.record.id).not.toBe("class");
  expect(change.record.revision).toBeFalsy();
  expect(change.record.data.recurrence).toBeUndefined();
  expect(mock.back).toHaveBeenCalled();
});

describe("editing one of the extra logs", () => {
  const log = (kind: BabyRecord["kind"], title: string, data: Record<string, unknown>, id = "log") => ({ ...optimisticRecord({ id, kind, title, body: "", child_id: "baby", occurred_at: "2026-11-04T02:00:00.000Z", data: data as never }), revision: 1 });
  const field = (label: string) => found("Field", (p) => p.label === label);
  const saved = (account: any) => account.state.outbox.find((m: Mutation) => m.type === "save")?.record;
  it("won't save a reading on the wrong scale, then saves the fixed one in place of the old", async () => {
    const account = setup([log("temperature", "Temperature", { value: 99.1, unit: "f", method: "armpit" })]);
    mock.params = { id: "log", kind: "temperature" };
    await mount(Edit);
    expect(field("Title")).toBeUndefined();
    await act(async () => field("Temperature").props.onChange("37"));
    await press("Button", "Save changes");
    expect(saved(account)).toBeUndefined();
    expect(JSON.stringify(renderer!.toJSON())).toContain("Check the number");
    await act(async () => field("Temperature").props.onChange("100.2"));
    await press("Button", "Save changes");
    expect(saved(account)).toMatchObject({ kind: "temperature", title: "Temperature", child_id: "baby", data: { value: 100.2, unit: "f", method: "armpit" } });
  });
  it("8: keeps the same fields while she types a word that's another tracker's, then refuses it", async () => {
    const account = setup([log("custom", "Bath", { label: "Bath" })]);
    mock.params = { id: "log", kind: "custom" };
    await mount(Edit);
    await act(async () => field("What is it?").props.onChange("Blood pressure"));
    expect(field("What is it?")).toBeDefined();
    expect(field("Top number")).toBeUndefined();
    await press("Button", "Save changes");
    expect(saved(account)).toBeUndefined();
    expect(JSON.stringify(renderer!.toJSON())).toContain("its own place");
    await act(async () => field("What is it?").props.onChange("Shot"));
    expect(field("Title")).toBeUndefined();
  });
  it("9: keeps her log hers and a baby's log on a baby", async () => {
    setup([log("custom", "118/76", { label: "Blood pressure" }), { ...log("medicine", "Tylenol", { name: "Tylenol" }, "dose") }]);
    const her = { ...mock.baby.state.records[0], child_id: null };
    mock.baby.state.records = [her, mock.baby.state.records[1]];
    mock.params = { id: "log", kind: "custom" };
    await mount(Edit);
    expect(found("Chips", (p) => p.label === "Who is this for?")).toBeUndefined();
    await act(async () => renderer!.unmount());
    mock.params = { id: "dose", kind: "medicine" };
    await mount(Edit);
    expect(found("Chips", (p) => p.label === "Who is this for?").props.options.map((option: any) => option.label)).toEqual(["Noa"]);
  });
  it("doesn't offer a saved family log a baby the API would refuse", async () => {
    setup([{ ...log("feeding", "Feed", {}, "fed"), child_id: "ours", space_id: "fam" }]);
    Object.assign(mock.baby.state.bootstrap, { personal_space_id: "mine", spaces: [{ id: "mine", kind: "personal", role: "parent", generation: 1, access_version: 1 }, { id: "fam", kind: "family", role: "parent", generation: 1, access_version: 1 }],
      children: [{ id: "ours", name: "Noa", revision: 1, space_id: "fam", generation: 1 }, { id: "test", name: "Test", revision: 1, space_id: "mine", generation: 1 }] });
    mock.params = { id: "fed", kind: "feeding" };
    await mount(Edit);
    expect(found("Chips", (p) => p.label === "Who is this for?").props.options.map((option: any) => option.value)).toEqual(["ours"]);
  });
  it("doesn't offer a saved family event a baby the API would refuse", async () => {
    setup([{ ...event({}, "seen"), child_id: "ours", space_id: "fam" }]);
    Object.assign(mock.baby.state.bootstrap, { personal_space_id: "mine", spaces: [{ id: "mine", kind: "personal", role: "parent", generation: 1, access_version: 1 }, { id: "fam", kind: "family", role: "parent", generation: 1, access_version: 1 }],
      children: [{ id: "ours", name: "Noa", revision: 1, space_id: "fam", generation: 1 }, { id: "test", name: "Test", revision: 1, space_id: "mine", generation: 1 }] });
    mock.params = { id: "seen", kind: "event" };
    await mount(Edit);
    const chooser = renderer!.root.findAll((n) => JSON.stringify(n.props.options ?? []).includes("ours"));
    expect(chooser.length).toBeGreaterThan(0);
    expect(JSON.stringify(chooser[0].props.options)).not.toContain("test");
  });
  it("tells a caregiver a new post stays with them", async () => {
    setup([]);
    Object.assign(mock.baby.state.bootstrap, { personal_space_id: "mine", spaces: [{ id: "mine", kind: "personal", role: "parent", generation: 1, access_version: 1 }, { id: "fam", kind: "family", role: "caregiver", generation: 1, access_version: 1 }],
      children: [{ id: "baby", name: "Noa", revision: 1, space_id: "fam", generation: 1 }] });
    mock.params = { kind: "source" };
    await mount(Edit);
    expect(JSON.stringify(renderer!.toJSON())).toMatch(/Only you can see this\. It isn’t shared with the family\./);
  });
  it("18: won't save a log at a time that hasn't happened", async () => {
    const account = setup([log("medicine", "Tylenol", { name: "Tylenol" })]);
    mock.params = { id: "log", kind: "medicine" };
    await mount(Edit);
    await act(async () => renderer!.root.findAll((n) => String(n.type) === "DateField").find((n) => n.props.label === "Date and time")!.props.onChange(new Date(Date.now() + 5 * 3600_000).toISOString()));
    await press("Button", "Save changes");
    expect(saved(account)).toBeUndefined();
    expect(JSON.stringify(renderer!.toJSON())).toContain("hasn’t happened yet");
  });
  it("20: an entry of a kind this build doesn't know opens without crashing", async () => {
    setup([log("future_kind" as never, "From a newer build", {})]);
    mock.params = { id: "log", kind: "future_kind" };
    await mount(Edit);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("undefined");
    expect(found("Button", (p) => p.title === "Save changes")).toBeDefined();
  });
  it("keeps a medicine's title to its name", async () => {
    const account = setup([log("medicine", "Vitamin D", { name: "Vitamin D" })]);
    mock.params = { id: "log", kind: "medicine" };
    await mount(Edit);
    await act(async () => field("Name").props.onChange("Gas drops"));
    await act(async () => field("Dose (optional)").props.onChange("0.3 mL"));
    await press("Button", "Save changes");
    expect(saved(account)).toMatchObject({ title: "Gas drops", data: { name: "Gas drops", dose: "0.3 mL" } });
  });
  it("leaves a shot as it was: its name in the title, its label untouched", async () => {
    const account = setup([log("custom", "Hep B", { label: "Shot" })]);
    mock.params = { id: "log", kind: "custom" };
    await mount(Edit);
    expect(field("What is it?")).toBeUndefined();
    await act(async () => field("Title").props.onChange("Hep B dose 2"));
    await press("Button", "Save changes");
    expect(saved(account)).toMatchObject({ title: "Hep B dose 2", child_id: "baby", data: { label: "Shot" } });
  });
});

describe("from the re-check of #543: typed log input outlives the editor", () => {
  const bp = () => ({ ...optimisticRecord({ id: "bp", kind: "custom", title: "118/76", body: "", child_id: null, occurred_at: "2026-11-04T02:00:00Z", data: { label: "Blood pressure" } }), revision: 1 });
  const top = () => found("Field", (p) => p.label === "Top number");
  it("brings back a cleared number, and still won't save it", async () => {
    const account = setup([bp()]);
    mock.params = { id: "bp", kind: "custom" };
    await mount(Edit);
    await act(async () => top().props.onChange(""));
    await act(async () => renderer!.unmount());
    await mount(Edit);
    expect(top().props.value).toBe("");
    await press("Button", "Save changes");
    expect(account.state.outbox).toEqual([]);
    expect(JSON.stringify(renderer!.toJSON())).toContain("Enter both numbers");
  });
  it("never sends the typed form to the API", async () => {
    const account = setup([bp()]);
    mock.params = { id: "bp", kind: "custom" };
    await mount(Edit);
    await act(async () => top().props.onChange("120"));
    await press("Button", "Save changes");
    const record = account.state.outbox.find((m: Mutation) => m.type === "save")?.record;
    expect(record).toMatchObject({ title: "120/76", data: { label: "Blood pressure" } });
    expect(record).not.toHaveProperty("log_form");
  });
});

describe("the form opens on a name, a date and Save", () => {
  const texts = () => renderer!.root.findAll((n) => typeof n.type === "string").flatMap((n) => n.children.filter((child) => typeof child === "string")).join(" ");
  const nameField = () => found("Field", (p) => p.label === "Name");
  const more = () => renderer!.root.findAll((n) => n.props.accessibilityLabel === "More details" || String(n.props.accessibilityLabel).startsWith("More details"))[0];
  const openNew = async () => { setup([]); mock.params = { kind: "event", day: "2026-11-20" }; await mount(Edit); };
  const remindersOn = (b: any) => { b.state.bootstrap = { ...b.state.bootstrap, reminders: { push: true } }; return b; };

  it("has nothing before the name, and everything else behind one More details", async () => {
    await openNew();
    expect(renderer!.root.findAll((n) => String(n.type) === "Field").map((n) => n.props.label)).toEqual(["Name"]);
    for (const hidden of ["Repeat", "Category", "Location", "Note", "Who"]) expect(texts()).not.toContain(hidden);
    expect(more()).toBeDefined();
    await act(async () => more().props.onPress());
    expect(renderer!.root.findAll((n) => String(n.type) === "Field").map((n) => n.props.label)).toEqual(expect.arrayContaining(["Name", "Location (optional)", "Who’s coming (optional)", "Note (optional)"]));
  });
  it("a car appointment saves with just a typed name, no kind asked for", async () => {
    await openNew();
    await act(async () => nameField().props.onChange("Car appointment"));
    await press("Button", "Save event");
    const queued = mock.baby.state.outbox[0];
    expect(queued.record).toMatchObject({ kind: "event", title: "Car appointment" });
    expect(queued.record.data.all_day).toBe(true);
    expect(new Date(queued.record.occurred_at).toISOString()).toBe("2026-11-19T14:00:00.000Z");
  });
  it("a suggestion fills the name, and she can still change it", async () => {
    await openNew();
    await act(async () => found("FilterChips", (p) => p.label === "Suggestions").props.onChange("Birthday"));
    expect(nameField().props.value).toBe("Birthday");
    await act(async () => nameField().props.onChange("Noa’s birthday"));
    await press("Button", "Save event");
    expect(mock.baby.state.outbox[0].record).toMatchObject({ title: "Noa’s birthday", data: { recurrence: { frequency: "yearly" }, category: "celebration" } });
  });
  it("says what a suggestion set, while More details stays shut", async () => {
    await openNew();
    await act(async () => found("FilterChips", (p) => p.label === "Suggestions").props.onChange("Birthday"));
    expect(more().props.accessibilityState.expanded).toBe(false);
    expect(texts()).toContain("Every year");
  });
  it("offers the names she's used before, newest first, once each", async () => {
    setup([{ ...event({ category: "other" }, "a"), updated_at: "2026-10-01T00:00:00.000Z" }, { ...event({}, "b"), title: "Dentist", updated_at: "2026-11-05T00:00:00.000Z" }, { ...event({}, "c"), title: "dentist", updated_at: "2026-11-01T00:00:00.000Z" }]);
    mock.params = { kind: "event" };
    await mount(Edit);
    const names = found("FilterChips", (p) => p.label === "Suggestions").props.options.map((o: any) => o.label);
    expect(names.filter((name: string) => /dentist/i.test(name))).toEqual(["Dentist"]);
    expect(names).toContain("Class");
    expect(names.indexOf("Dentist")).toBeLessThan(names.indexOf("Class"));
  });
  it("opens an existing event with what it already has showing", async () => {
    remindersOn(setup([event({ location: "Clinic", attendees: ["Grandma"], reminder_minutes: [1440] })]));
    mock.params = { kind: "event", id: "class" };
    await mount(Edit);
    expect(more().props.accessibilityState.expanded).toBe(true);
    expect(found("Field", (p) => p.label === "Location (optional)").props.value).toBe("Clinic");
    expect(found("Field", (p) => p.label === "Who’s coming (optional)").props.value).toBe("Grandma");
    expect(found("FilterChips", (p) => p.label === "Reminder").props.value).toBe("1440");
  });
  it("opens a plain event with More details shut", async () => {
    setup([{ ...event(), data: { timezone: guam, all_day: true, category: "other", attendees: [] } }]);
    mock.params = { kind: "event", id: "class" };
    await mount(Edit);
    expect(more().props.accessibilityState.expanded).toBe(false);
  });
  it("keeps who's coming as names, and never breaks the API's rule on them", async () => {
    await openNew();
    await act(async () => nameField().props.onChange("Baptism"));
    await act(async () => more().props.onPress());
    await act(async () => found("Field", (p) => p.label === "Who’s coming (optional)").props.onChange("Grandma, grandma ,, Auntie Rose,"));
    await press("Button", "Save event");
    expect(mock.baby.state.outbox[0].record.data.attendees).toEqual(["Grandma", "Auntie Rose"]);
  });
  it("sets one reminder, and clears it, once reminders are on", async () => {
    remindersOn(setup([]));
    mock.params = { kind: "event", day: "2026-11-20" };
    await mount(Edit);
    await act(async () => more().props.onPress());
    const reminder = () => found("FilterChips", (p) => p.label === "Reminder");
    await act(async () => reminder().props.onChange("1440"));
    expect(reminder().props.value).toBe("1440");
    await act(async () => reminder().props.onChange(""));
    await act(async () => nameField().props.onChange("Baptism"));
    await press("Button", "Save event");
    expect(mock.baby.state.outbox[0].record.data.reminder_minutes).toEqual([]);
  });
  it("keeps reminders it has no chip for until she picks one", async () => {
    remindersOn(setup([event({ reminder_minutes: [30, 120] })]));
    mock.params = { kind: "event", id: "class" };
    await mount(Edit);
    await press("Button", "Save changes");
    expect(mock.baby.state.outbox[0].record.data.reminder_minutes).toEqual([30, 120]);
  });
  it("doesn't offer to discard a form nothing has been put in", async () => {
    await openNew();
    expect(renderer!.root.findAll((n) => n.props.title === "Discard this draft")).toHaveLength(0);
    await act(async () => nameField().props.onChange("Dentist"));
    expect(renderer!.root.findAll((n) => n.props.title === "Discard this draft")).toHaveLength(1);
  });
  it("with reminders off, offers no reminder, and says nothing about one", async () => {
    await openNew();
    await act(async () => more().props.onPress());
    expect(renderer!.root.findAll((n) => n.props.label === "Reminder")).toHaveLength(0);
    expect(texts()).not.toMatch(/Reminder|notifications/);
  });
  it("with reminders off, keeps one she already has, without calling it out or opening More details for it", async () => {
    setup([{ ...event({ recurrence: null, reminder_minutes: [1440] }), data: { timezone: guam, all_day: true, category: "other", attendees: [], reminder_minutes: [1440] } }]);
    mock.params = { kind: "event", id: "class" };
    await mount(Edit);
    expect(more().props.accessibilityState.expanded).toBe(false);
    expect(more().props.accessibilityLabel).toBe("More details");
    await press("Button", "Save changes");
    expect(mock.baby.state.outbox[0].record.data.reminder_minutes).toEqual([1440]);
  });
  it("with reminders off, the event's own screen doesn't promise one", async () => {
    setup([event({ reminder_minutes: [1440], recurrence: null }, "party")]);
    mock.params = { id: "party" };
    await mount(EventDetail);
    expect(texts()).not.toContain("Reminder");
  });
  it("shows who's coming and the reminder on the event", async () => {
    remindersOn(setup([event({ attendees: ["Grandma", "Auntie Rose"], reminder_minutes: [1440], recurrence: null }, "party")]));
    mock.params = { id: "party" };
    await mount(EventDetail);
    expect(texts()).toContain("Grandma, Auntie Rose");
    expect(texts()).toContain("1 day before");
  });
});

describe("any event works", () => {
  const nameField = () => found("Field", (p) => p.label === "Name");
  const more = () => renderer!.root.findAll((n) => String(n.props.accessibilityLabel).startsWith("More details"))[0];
  const category = () => found("FilterChips", (p) => p.label === "Category");
  const openNew = async (rows: BabyRecord[] = []) => { const b = setup(rows); mock.params = { kind: "event", day: "2026-11-20" }; await mount(Edit); return b; };

  it("types a category once and it's there next time", async () => {
    const b = await openNew();
    await act(async () => nameField().props.onChange("Oil change"));
    await act(async () => more().props.onPress());
    await act(async () => category().props.onChange("new"));
    await act(async () => found("Field", (p) => p.label === "Your category").props.onChange(" Car "));
    await press("Button", "Save event");
    expect(b.state.outbox[0].record.data).toMatchObject({ category: "other", category_label: "Car" });
    await act(async () => renderer!.unmount());
    mock.params = { kind: "event" };
    await mount(Edit);
    await act(async () => more().props.onPress());
    expect(category().props.options.map((o: any) => o.label)).toContain("Car");
  });
  it("a birthday, a dentist visit and a car appointment each save with no type chosen", async () => {
    for (const title of ["Dentist", "Car appointment", "Birthday party"]) {
      const b = await openNew();
      await act(async () => nameField().props.onChange(title));
      await press("Button", "Save event");
      expect(b.state.outbox[0].record).toMatchObject({ title, data: { category: "other" } });
      expect(b.state.outbox[0].record.data.category_label).toBeUndefined();
      await act(async () => renderer!.unmount());
    }
  });
  it("calls only an explicit doctor's appointment one, so a car appointment doesn't open doctor questions", async () => {
    const car = { ...event({ recurrence: null, category: "other", category_label: "Car" }, "car"), title: "Car appointment" };
    setup([car]);
    mock.params = { id: "car" };
    await mount(EventDetail);
    expect(renderer!.root.findAll((n) => n.props.title === "Book next")).toHaveLength(0);
    expect(renderer!.root.findAll((n) => String(n.type) === "VisitSections")).toHaveLength(0);
    await act(async () => renderer!.unmount());
    setup([{ ...event({ recurrence: null, category: "appointment" }, "dr"), title: "Dr. Cruz" }]);
    mock.params = { id: "dr" };
    await mount(EventDetail);
    expect(renderer!.root.findAll((n) => n.props.title === "Book next")).toHaveLength(1);
  });
  it("says what a doctor's appointment brings, once she's chosen it", async () => {
    await openNew();
    await act(async () => found("FilterChips", (p) => p.label === "Suggestions").props.onChange("Doctor’s appointment"));
    const copy = renderer!.root.findAll((n) => String(n.type) === "Copy").flatMap((n) => n.children).join(" ");
    expect(copy).toContain("questions");
  });
  it("names an event without a category plainly, and never Other", async () => {
    setup([{ ...event({ recurrence: null, category: "other" }, "plain"), title: "Picnic" }]);
    mock.params = { id: "plain" };
    await mount(EventDetail);
    expect(mock.title).toBe("Event");
  });
  it("in a family, starts shared and changing from Shared to Just me clears a family baby", async () => {
    const b = setup([]);
    b.state.bootstrap = { ...b.state.bootstrap, personal_space_id: "me", spaces: [{ id: "me", kind: "personal", role: "owner", generation: 1, access_version: 1 }, { id: "fam", kind: "family", role: "parent", generation: 1, access_version: 1 }],
      children: [{ id: "baby", name: "Noa", revision: 1, space_id: "fam", generation: 1 }] };
    b.state.selectedChild = "baby";
    mock.params = { kind: "event", day: "2026-11-20" };
    await mount(Edit);
    expect(more().props.accessibilityLabel).toContain("Shared with family");
    await act(async () => nameField().props.onChange("Date night"));
    await act(async () => more().props.onPress());
    const who = () => found("FilterChips", (p) => p.label === "Who can see this");
    expect(who().props.value).toBe("shared");
    await act(async () => who().props.onChange("shared"));
    await act(async () => who().props.onChange("just_me"));
    await press("Button", "Save event");
    expect(b.state.outbox[0]).toMatchObject({ space_id: "me", record: { title: "Date night", child_id: null } });
    expect(b.state.outbox[0].record.data.just_me).toBeUndefined();
  });
  it("in a family, saves shared with no choice made", async () => {
    const b = setup([]);
    b.state.bootstrap = { ...b.state.bootstrap, personal_space_id: "me", spaces: [{ id: "me", kind: "personal", role: "owner", generation: 1, access_version: 1 }, { id: "fam", kind: "family", role: "parent", generation: 1, access_version: 1 }],
      children: [{ id: "baby", name: "Noa", revision: 1, space_id: "fam", generation: 1 }] };
    mock.params = { kind: "event", day: "2026-11-20" };
    await mount(Edit);
    await act(async () => nameField().props.onChange("Baptism"));
    await press("Button", "Save event");
    expect(b.state.outbox[0]).toMatchObject({ space_id: "fam", record: { title: "Baptism" } });
  });
  const inFamily = (b: any) => { b.state.bootstrap = { ...b.state.bootstrap, personal_space_id: "me", spaces: [{ id: "me", kind: "personal", role: "owner", generation: 1, access_version: 1 }, { id: "fam", kind: "family", role: "parent", generation: 1, access_version: 1 }], children: [] }; };
  it("Book next goes where the form says: a shared visit's next one is shared, a private one's stays private", async () => {
    for (const [space, shown, destination] of [["fam", "Shared with family", "fam"], ["me", "Just me", "me"]]) {
      const b = setup([{ ...event({ recurrence: null, category: "appointment" }, "dr"), title: "Dr. Cruz", space_id: space }]);
      inFamily(b);
      mock.params = { kind: "event", from: "dr", at: "2026-11-02T00:00:00.000Z" };
      await mount(Edit);
      expect(more().props.accessibilityLabel).toContain(shown);
      await press("Button", "Save next visit");
      expect(b.state.outbox[0].space_id).toBe(destination);
      await act(async () => renderer!.unmount());
    }
  });
  const familyWithBaby = (b: any) => { inFamily(b); b.state.bootstrap = { ...b.state.bootstrap, children: [{ id: "baby", name: "Noa", revision: 1, space_id: "fam", generation: 1 }] }; b.state.selectedChild = "baby"; };
  const who = () => found("FilterChips", (p) => p.label === "Who can see this");
  const words = () => renderer!.root.findAll((n) => String(n.type) === "Copy").flatMap((n) => n.children).join(" ");
  it("says plainly why Just me leaves the family's baby off, and puts her back on Shared", async () => {
    const b = setup([]);
    familyWithBaby(b);
    mock.params = { kind: "event", day: "2026-11-20" };
    await mount(Edit);
    await act(async () => nameField().props.onChange("Check-up"));
    await act(async () => more().props.onPress());
    await act(async () => who().props.onChange("shared"));
    expect(found("FilterChips", (p) => p.label === "Who is it for?").props.value).toBe("baby");
    expect(words()).not.toContain("can’t be on");
    await act(async () => who().props.onChange("just_me"));
    expect(words()).toContain("A Just me event can’t be on the family’s baby.");
    await act(async () => who().props.onChange("shared"));
    expect(words()).not.toContain("can’t be on");
    expect(found("FilterChips", (p) => p.label === "Who is it for?").props.value).toBe("baby");
    await press("Button", "Save event");
    expect(b.state.outbox[0]).toMatchObject({ space_id: "fam", record: { child_id: "baby" } });
  });
  it("doesn't put a baby back if she chose no baby before going to Just me", async () => {
    const b = setup([]);
    familyWithBaby(b);
    mock.params = { kind: "event", day: "2026-11-20" };
    await mount(Edit);
    await act(async () => more().props.onPress());
    await act(async () => who().props.onChange("shared"));
    await act(async () => found("FilterChips", (p) => p.label === "Who is it for?").props.onChange(""));
    await act(async () => who().props.onChange("just_me"));
    await act(async () => who().props.onChange("shared"));
    expect(found("FilterChips", (p) => p.label === "Who is it for?").props.value).toBe("");
  });
  it("names the baby while More details is shut, on an event with nothing else", async () => {
    setup([{ ...event({}, "e"), child_id: "baby", data: { timezone: guam, all_day: true, category: "other", attendees: [] } }]);
    mock.params = { kind: "event", id: "e" };
    await mount(Edit);
    expect(more().props.accessibilityState.expanded).toBe(false);
    expect(more().props.accessibilityLabel).toBe("More details. Noa");
  });
  it("names no baby on an event for the whole family", async () => {
    setup([{ ...event({}, "e"), child_id: null, data: { timezone: guam, all_day: true, category: "other", attendees: [] } }]);
    mock.params = { kind: "event", id: "e" };
    await mount(Edit);
    expect(more().props.accessibilityLabel).toBe("More details");
  });
  it("keeps a visit's questions and notes in sight after it stops being an appointment, with no Book next", async () => {
    const family = { ...event({ recurrence: null, category: "family" }, "was"), title: "Was a visit" },
      question = optimisticRecord({ id: "q", kind: "question", title: "Ask about sleep", body: "", child_id: null, occurred_at: "2026-11-01T00:00:00.000Z", data: { event_id: "was" } });
    setup([family, question]);
    mock.params = { id: "was" };
    await mount(EventDetail);
    expect(renderer!.root.findAll((n) => String(n.type) === "VisitLinks")[0].props.visit.id).toBe("was");
    expect(renderer!.root.findAll((n) => n.props.title === "Book next")).toHaveLength(0);
    expect(renderer!.root.findAll((n) => String(n.type) === "VisitSections")).toHaveLength(0);
    await press("Button", "Delete event");
    expect(mock.alerts[0][1]).toContain("Its questions and notes stay in your Journal");
  });
  it("with the family flag off, asks nothing and adds nothing", async () => {
    const b = await openNew();
    await act(async () => more().props.onPress());
    expect(renderer!.root.findAll((n) => n.props.label === "Who can see this")).toHaveLength(0);
    await act(async () => nameField().props.onChange("Baptism"));
    await press("Button", "Save event");
    expect(b.state.outbox[0].space_id).toBeUndefined();
  });
});

describe("adding to the phone's calendar", () => {
  const open = async () => { setup([event({ recurrence: null }, "e")]); mock.params = { id: "e" }; await mount(EventDetail); };
  const buttons = () => renderer!.root.findAll((n) => n.props.title === "Add to my phone’s calendar");
  beforeEach(() => { mock.phone = { available: true, added: [], result: "saved" }; });
  it("is one tap, and says so when it's saved", async () => {
    await open();
    await press("Button", "Add to my phone’s calendar");
    expect(mock.phone.added).toEqual([{ title: "from-helper" }]);
    expect(mock.toast).toHaveBeenCalledWith("Added to your phone’s calendar.");
  });
  it("says nothing when she cancels the sheet, or the phone can't tell", async () => {
    for (const result of ["canceled", "done"]) {
      await open();
      mock.phone.result = result; mock.toast.mockClear();
      await press("Button", "Add to my phone’s calendar");
      expect(mock.toast).not.toHaveBeenCalled();
      await act(async () => renderer!.unmount());
    }
  });
  it("says so plainly when the sheet won't open", async () => {
    mock.phone.result = "unavailable";
    await open();
    await press("Button", "Add to my phone’s calendar");
    expect(mock.toast).toHaveBeenCalledWith("Your phone’s calendar couldn’t open.");
  });
  it("isn't there on a binary without it", async () => {
    mock.phone.available = false;
    await open();
    expect(buttons()).toHaveLength(0);
  });
  it("copies nothing until she taps", async () => {
    await open();
    expect(mock.phone.added).toEqual([]);
  });
});

it("passes the shown occurrence date to visit capture, including a moved date", async () => {
  const event = { ...optimisticRecord({ id: "visit", kind: "event", title: "Visit", body: "", child_id: "baby", occurred_at: "2026-11-01T00:00:00Z", data: { category: "appointment", timezone: "UTC", recurrence: { frequency: "weekly" }, exceptions: [{ original_start: "2026-11-08T00:00:00Z", overrides: { start: "2026-11-09T00:00:00Z" } }] } }), revision: 1 };
  setup([event]); mock.params = { id: event.id, at: "2026-11-08T00:00:00Z" };
  await mount(EventDetail);
  expect(renderer!.root.findAll((n) => String(n.type) === "VisitSections")[0].props.visit.occurred_at).toBe("2026-11-09T00:00:00.000Z");
});

it("passes an occurrence all-day override to visit capture", async () => {
  const original = "2026-11-09T00:00:00.000Z";
  setup([event({ category: "appointment", all_day: false, exceptions: [{ original_start: original, overrides: { all_day: true } }] })]);
  mock.params = { id: "class", at: original }; await mount(EventDetail);
  expect(renderer!.root.findAll((n) => String(n.type) === "VisitSections")[0].props.visit.data.all_day).toBe(true);
});

it("hides newborn pregnancy labels even for an already-saved snapshot and clears it on save", async () => {
  const row = { ...event({ category: "appointment", recurrence: null, due_date_snapshot: "2026-12-10", clinician_age: "40 weeks" }, "born-visit"), child_id: "baby", occurred_at: "2026-12-14T00:00:00Z" };
  const b = setup([row]);b.state.bootstrap.children = [{ id: "baby", name: "Noa", due_date: "2026-12-10", birth_date: "2026-12-05", revision: 1 }];
  mock.params = { id: row.id };await mount(EventDetail);
  expect(renderer!.root.findAll((n) => String(n.type) === "Copy" && String(n.props.children).includes("Estimated from due date"))).toHaveLength(0);
  expect(JSON.stringify(renderer!.toJSON())).not.toContain("Clinic’s stated week");
  await act(async () => renderer!.unmount());mock.params = { kind: "event", id: row.id };await mount(Edit);
  expect(renderer!.root.findAll((n) => String(n.type) === "Copy" && String(n.props.children).includes("Estimated from due date"))).toHaveLength(0);
  await press("Button", "Save changes");
  expect(b.state.outbox[0].record.data.due_date_snapshot).toBeNull();
});
it("lets the contributor remove original pasted words from a shared visit", async () => {
  const row = { ...event({ category: "appointment", recurrence: null, paste_origin: { text: "original", start: 0, end: 8, original: false } }, "pasted"), created_by: "o" };
  const b = setup([row]);mock.params = { kind: "event", id: row.id };await mount(Edit);
  await press("Button", "Remove original pasted words");await press("Button", "Save changes");
  expect(b.state.outbox[0].record.data.paste_origin).toBeNull();
});
it("does not show cached visit medical words to a caregiver", async () => {
  const row = { ...event({ category: "appointment", recurrence: null, results: "Private results", paste_origin: { text: "Private original", start: 0, end: 16, original: false }, clinician_age: "35 weeks" }, "caregiver-visit"), body: "Private notes", space_id: "fam" };
  const b = setup([row]);b.state.bootstrap.spaces = [{ id: "fam", kind: "family", role: "caregiver", generation: 1 }];
  mock.params = { id: row.id };await mount(EventDetail);
  const rendered = JSON.stringify(renderer!.toJSON());
  expect(rendered).not.toContain("Private");expect(rendered).not.toContain("Clinic’s stated week");
});

it("keeps a recategorized visit private for a caregiver, including cached body text", async () => {
  const row = { ...event({ category: "other", category_label: "Class", recurrence: null, medical_visit: true }, "old-visit"), body: "Medical visit body", space_id: "fam" };
  const b = setup([row]);b.state.bootstrap.spaces = [{ id: "fam", kind: "family", role: "caregiver", generation: 1 }];
  mock.params = { id: row.id };await mount(EventDetail);
  expect(JSON.stringify(renderer!.toJSON())).not.toContain("Medical visit body");
});
it("shows an explicitly pending result without result text", async () => {
  const row = event({ category: "appointment", recurrence: null, result_status: "pending" }, "pending-visit");setup([row]);mock.params = { id: row.id };await mount(EventDetail);
  expect(JSON.stringify(renderer!.toJSON())).toContain("pending");
});
it("offers personal note capture on an ordinary caregiver class", async () => {
  const row = { ...event({ category: "other", category_label: "Class", recurrence: null }, "care-class"), space_id: "fam" };
  const b = setup([row]);b.state.bootstrap.spaces = [{ id: "fam", kind: "family", role: "caregiver", generation: 1 }];
  mock.params = { id: row.id };await mount(EventDetail);
  expect(renderer!.root.findAllByType("EventNotes" as any)).toHaveLength(1);
});

it("normalizes the future replacement snapshot for a born child", async () => {
  const row = { ...event({ category: "appointment", due_date_snapshot: "2026-12-10" }, "born-series"), child_id: "baby" };
  const b = setup([row]);b.state.bootstrap.children = [{ id: "baby", name: "Noa", due_date: "2026-12-10", birth_date: "2026-11-05", revision: 1 }];
  mock.params = { kind: "event", id: row.id, scope: "future", at: "2026-11-16T00:00:00.000Z" };
  await mount(Edit);await press("Button", "Save changes");
  expect(b.state.outbox[0].type).toBe("event_split");
  expect(b.state.outbox[0].event.data.due_date_snapshot).toBeNull();
});

it("hides medical fields when a caregiver creates a family appointment without an explicit space", async () => {
  const b = setup([]);
  b.state.bootstrap.personal_space_id = "personal";
  b.state.bootstrap.spaces = [{ id: "fam", kind: "family", role: "caregiver", generation: 1 }];
  b.state.bootstrap.children = [{ id: "baby", name: "Noa", revision: 1, space_id: "fam" }];
  b.state.drafts.newVisit = { id: "new-visit", kind: "event", title: "Checkup", body: "", child_id: "baby", occurred_at: "2026-11-09T00:00:00Z", files: [], data: { category: "appointment", timezone: guam } };
  mock.params = { kind: "event", draft: "newVisit" };await mount(Edit);
  const labels = renderer!.root.findAll((n) => String(n.type) === "Field").map((n) => n.props.label);
  expect(labels).not.toContain("Results (optional)");expect(labels).not.toContain("Clinic’s stated week (optional)");expect(labels).not.toContain("Doctor (optional)");
  await press("Button", "Save event");
  expect(b.state.outbox[0]).toMatchObject({ space_id: "fam", record: { child_id: "baby" } });
});
it.each([true, false])("saves a private follow-up with a valid child link (family child: %s)", async (familyChild) => {
  const row = { ...event({ category: "appointment", recurrence: null, follow_up: "Bring the report" }, "followup-visit"), child_id: "baby", space_id: familyChild ? "fam" : "personal" };
  const b = setup([row]);b.state.bootstrap.personal_space_id = "personal";
  b.state.bootstrap.spaces = [{ id: "personal", kind: "personal", role: "parent", generation: 1 }, { id: "fam", kind: "family", role: "parent", generation: 1 }];
  b.state.bootstrap.children = [{ id: "baby", name: "Noa", revision: 1, space_id: row.space_id }];
  mock.params = { id: row.id };await mount(EventDetail);await press("Button", "Make a follow-up calendar item");
  const target = mock.push.mock.calls.at(-1)![0];await act(async () => renderer!.unmount());mock.params = target.params;await mount(Edit);await press("Button", "Save event");
  expect(b.state.outbox[0]).toMatchObject({ space_id: "personal", record: { body: "Bring the report", child_id: familyChild ? null : "baby", data: { reminder_minutes: [] } } });
});

it.each([false, true])("hides postpartum weeks on an unattached shared visit and clears its old snapshot (%s)", async (stored) => {
  const row = { ...event({ category: "appointment", recurrence: null, clinician_age: "Clinic words", ...(stored ? { due_date_snapshot: "2026-12-10" } : {}) }, "postpartum"), child_id: null, space_id: "fam", occurred_at: "2026-12-17T00:00:00Z" };
  const b = setup([row]);b.state.bootstrap.personal_space_id = "me";
  b.state.bootstrap.spaces = [{ id: "fam", kind: "family", role: "parent", generation: 1 }];
  b.state.bootstrap.children = [{ id: "baby", name: "Noa", space_id: "fam", due_date: "2026-12-10", birth_date: "2026-12-10", revision: 1 }];
  mock.params = { id: row.id };await mount(EventDetail);
  expect(JSON.stringify(renderer!.toJSON())).not.toContain("Estimated from due date");
  expect(JSON.stringify(renderer!.toJSON())).not.toContain("Clinic’s stated week");
  await act(async () => renderer!.unmount());mock.params = { kind: "event", id: row.id };await mount(Edit);
  expect(renderer!.root.findAll((n) => String(n.type) === "Field" && n.props.label === "Clinic’s stated week (optional)")).toHaveLength(0);
  expect(renderer!.root.findAll((n) => String(n.type) === "Copy" && String(n.props.children).includes("Estimated from due date"))).toHaveLength(0);
  await press("Button", "Save changes");
  const saved = b.state.outbox[0].record;
  expect(saved.child_id).toBeNull();expect(saved.space_id).toBe("fam");
  expect(saved.data.due_date_snapshot).toBe(stored ? null : undefined);
  expect(saved.data.clinician_age).toBe("Clinic words");
});
