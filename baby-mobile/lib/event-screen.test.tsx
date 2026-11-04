import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
