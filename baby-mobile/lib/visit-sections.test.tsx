import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type EventOccurrence, type Mutation } from "./models";

const mock = vi.hoisted(() => ({ baby: null as any, upcoming: [] as any[], push: vi.fn(), toast: vi.fn(), ids: 0 }));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("expo-router", () => ({ router: { push: mock.push } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `id-${++mock.ids}` }));
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
vi.mock("./context", () => ({ useBaby: () => mock.baby }));
vi.mock("@/lib/events", () => import("./events"));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/visits", () => import("./visits"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/use-visit", () => ({ useVisitRecords: vi.fn() }));
vi.mock("@/lib/use-events", () => ({ useUpcomingEvents: () => ({ items: mock.upcoming }) }));
const ui = vi.hoisted(() => ({ Button: "Button", Copy: "Copy", Field: "Field", Grouped: "Grouped", Notice: "Notice", Row: "Row", tap: vi.fn(), useToast: () => mock.toast }));
vi.mock("./ui", () => ui);
vi.mock("./record-row", () => ({ kindIcon: { question: "q", journal: "j" } }));
vi.mock("../components/ui", () => ui);
vi.mock("../components/record-row", () => ({ kindIcon: { question: "q", journal: "j" } }));
import { LinkQuestions, NextVisitQuestions, RecordVisit, VisitQuestions, VisitSections } from "../components/visit-sections";

const guam = "Pacific/Guam";
let renderer: ReactTestRenderer | undefined;
const record = (id: string, kind: BabyRecord["kind"], data: BabyRecord["data"] = {}) => optimisticRecord({ id, kind, title: id, body: "", child_id: null, occurred_at: "2026-11-01T00:00:00Z", data });
const appointment = (id: string, at: string, title = "OB visit", category: EventOccurrence["category"] = "appointment"): EventOccurrence => ({ event_id: id, original_start: at, occurrence_start: at, occurrence_end: null, all_day: false, timezone: guam, title, category, location: null, attendees: [], child_id: null, repeats: false, changed: false, revision: 1 });
function setup(records: BabyRecord[]) {
  const account: any = { state: { ...emptyState(), records, bootstrap: { generation: 1, active: true, ai_available: false, children: [], profile: { display_name: "", timezone: guam, ai_consent: false } } } as DeviceState,
    get records() { return [...account.state.records, ...account.state.outbox.map((m: Mutation) => (m as any).record).filter(Boolean)]; },
    queue: vi.fn(async (change: Mutation) => { account.state = { ...account.state, outbox: [...account.state.outbox, change] }; }) };
  mock.baby = account;
  return account;
}
const all = (type: string) => renderer!.root.findAll((n) => String(n.type) === type);
const row = (title: string) => all("Row").find((n) => n.props.title === title)!;
async function mount(node: React.ReactElement) { await act(async () => { renderer = create(node); }); }
async function add(label: string, action: string, text: string) {
  await act(async () => { all("Field").find((n) => n.props.label === label)!.props.onChange(text); });
  await act(async () => { await all("Button").find((n) => n.props.title === action)!.props.onPress(); });
}
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(console, "error").mockImplementation(() => undefined); vi.clearAllMocks(); mock.ids = 0; mock.upcoming = []; });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("adds a question from the appointment through the outbox, links it, and clears for the next", async () => {
  const b = setup([]);
  await mount(<VisitQuestions visit={{ id: "visit", child_id: "baby" }} />);
  await add("Add a question for the doctor", "Add question", "When do we start tummy time?");
  expect(b.state.outbox[0]).toMatchObject({ type: "save", record: { kind: "question", body: "When do we start tummy time?", child_id: "baby", data: { event_id: "visit" } } });
  expect(all("Field")[0].props.value).toBe("");
  // The account's state is what moves this list on, which a mock can't do by itself.
  await act(async () => { renderer!.update(<VisitQuestions visit={{ id: "visit", child_id: "baby" }} />); });
  expect(row("When do we start tummy time?")).toBeDefined();
});
it("keeps what she typed when it can't be saved, and says why", async () => {
  const b = setup([]);
  b.queue.mockRejectedValue(Error("Storage is full."));
  await mount(<VisitQuestions visit={{ id: "visit", child_id: null }} />);
  await add("Add a question for the doctor", "Add question", "Keep me");
  expect(all("Field")[0].props.value).toBe("Keep me");
  expect(all("Notice")[0].props.children).toBe("Storage is full.");
});
it("doesn't save an empty question, and its button says so", async () => {
  const b = setup([]);
  await mount(<VisitQuestions visit={{ id: "visit", child_id: null }} />);
  expect(all("Button")[0].props.disabled).toBe(true);
  await act(async () => { await all("Button")[0].props.onPress(); });
  expect(b.queue).not.toHaveBeenCalled();
});
it("keeps what the doctor said as a clinician instruction on this visit", async () => {
  const b = setup([]);
  await mount(<VisitSections visit={{ id: "visit", child_id: null }} />);
  await add("In your words", "Save this note", "Come back in a week");
  expect(b.state.outbox[0]).toMatchObject({ record: { kind: "journal", body: "Come back in a week", data: { provenance: "clinician_instruction", event_id: "visit" } } });
});
it("links a saved question to this visit with one tap, keeping the rest of it", async () => {
  const b = setup([{ ...record("loose", "question", { attachment_ids: ["a"] }), revision: 2 }]);
  await mount(<VisitSections visit={{ id: "visit", child_id: null }} />);
  await act(async () => { await row("loose").props.onPress(); });
  expect(b.state.outbox[0]).toMatchObject({ type: "save", record: { id: "loose", revision: 2, data: { event_id: "visit", attachment_ids: ["a"] } } });
});
it("on Today, names the visit when the next event is something else", async () => {
  setup([]);
  const future = new Date(Date.now() + 86_400_000).toISOString();
  await mount(<NextVisitQuestions separate items={[appointment("v", future)]} />);
  expect(all("Copy")[0].props.children).toContain("Questions for OB visit");
  await act(async () => renderer!.unmount());
  await mount(<NextVisitQuestions items={[appointment("v", future)]} />);
  expect(all("Copy")).toHaveLength(0);
  expect(all("Field")).toHaveLength(1);
});
it("shows nothing on Today when no appointment is coming", async () => {
  setup([]);
  await mount(<NextVisitQuestions items={[appointment("p", new Date(Date.now() + 86_400_000).toISOString(), "Party", "family")]} />);
  expect(renderer!.toJSON()).toBeNull();
});
it("in Journal, links every saved question to the next appointment with one tap", async () => {
  const b = setup([]), loose = [record("a", "question"), record("b", "question")];
  mock.upcoming = [appointment("v", new Date(Date.now() + 86_400_000).toISOString())];
  await mount(<LinkQuestions rows={[...loose, record("done", "question", { event_id: "other" })]} />);
  await act(async () => { await row("Add these 2 questions to OB visit").props.onPress(); });
  expect(b.state.outbox.map((m: any) => [m.record.id, m.record.data.event_id])).toEqual([["a", "v"], ["b", "v"]]);
  expect(mock.toast).toHaveBeenCalledWith("Added to OB visit.");
});
it("in Journal, offers nothing with no appointment or no loose question", async () => {
  setup([]);
  await mount(<LinkQuestions rows={[record("a", "question")]} />);
  expect(renderer!.toJSON()).toBeNull();
  await act(async () => renderer!.unmount());
  mock.upcoming = [appointment("v", new Date(Date.now() + 86_400_000).toISOString())];
  await mount(<LinkQuestions rows={[record("done", "question", { event_id: "v" })]} />);
  expect(renderer!.toJSON()).toBeNull();
});
it("on a question: one tap onto the next visit, and once on one, the way back", async () => {
  const b = setup([]);
  mock.upcoming = [appointment("v", new Date(Date.now() + 86_400_000).toISOString())];
  await mount(<RecordVisit record={record("q", "question")} />);
  await act(async () => { await row("Add to OB visit").props.onPress(); });
  expect((b.state.outbox[0] as any).record.data.event_id).toBe("v");
  await act(async () => renderer!.unmount());
  const again = setup([]);
  await mount(<RecordVisit record={record("q", "question", { event_id: "v" })} />);
  await act(async () => { await row("Take off this visit").props.onPress(); });
  // Explicit null: the API keeps a link that's only left out.
  expect((again.state.outbox[0] as any).record.data.event_id).toBeNull();
});
