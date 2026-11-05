import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type EditorDraft, type Mutation } from "./models";

const mock = vi.hoisted(() => ({ upcoming: { items: [] as any[] }, baby: null as any, params: {} as Record<string, string>, push: vi.fn(), back: vi.fn(), dismissTo: vi.fn(), toast: vi.fn(), alerts: [] as any[], ids: 0 }));
vi.mock("react-native", () => ({ View: "View", Image: "Image", Alert: { alert: (...args: unknown[]) => mock.alerts.push(args) }, AppState: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: "ios" } }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => mock.params, router: { push: mock.push, back: mock.back, dismissTo: mock.dismissTo } }));
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
vi.mock("@/components/date-field", () => ({ DateField: "DateField" }));
vi.mock("@/components/event-row", () => ({ CategoryTile: "CategoryTile", openEvent: vi.fn() }));
vi.mock("@/components/visit-sections", () => ({ VisitSections: "VisitSections" }));
vi.mock("@/lib/use-events", () => ({ useUpcomingEvents: () => mock.upcoming }));
vi.mock("@/lib/visits", () => import("./visits"));
vi.mock("@/components/event-fields", () => import("../components/event-fields"));
const ui = vi.hoisted(() => ({ Button: "Button", Card: "Card", Chips: "Chips", Choice: "Choice", Copy: "Copy", Field: "Field", Grouped: "Grouped", Loading: "Loading", Notice: "Notice", Row: "Row", Section: "Section",
  Screen: ({ children, footer }: { children: unknown; footer?: unknown }) => [children, footer], useToast: () => mock.toast, useColors: () => ({ categories: {} }) }));
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
  await act(async () => { found("Chips", (p) => p.label === "What’s it for?").props.onChange("Baptism"); });
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
  await act(async () => { found("Chips", (p) => p.label === "What’s it for?").props.onChange("Birthday"); });
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
it("All future can't start before the date it changes from, which the old series keeps", async () => {
  const b = setup([event()]);
  mock.params = { kind: "event", id: "class", scope: "future", at: "2026-11-16T00:00:00.000Z" };
  await mount(Edit);
  await act(async () => { found("DateField", (p) => p.label === "Date and time").props.onChange("2026-11-09T00:00:00.000Z"); });
  await press("Button", "Save changes");
  expect(b.state.outbox).toEqual([]);
  expect(mock.toast.mock.calls[0][0]).toContain("can’t start before the date you’re changing");
});
it("edits just one date as a change on the series, and offers only what one date can hold", async () => {
  const b = setup([event()]);
  mock.params = { kind: "event", id: "class", scope: "one", at: "2026-11-09T00:00:00.000Z" };
  await mount(Edit);
  expect(renderer!.root.findAll((n) => String(n.type) === "Chips").map((n) => n.props.label)).toEqual(["Category"]);
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
  expect(renderer!.root.findAll((n) => n.props.label === "What’s it for?")).toHaveLength(0);
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
