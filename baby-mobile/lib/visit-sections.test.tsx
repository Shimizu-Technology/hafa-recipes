import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { LinkQuestions, NextVisitQuestions, RecordVisit, useVisitDrafts, VisitLinks, VisitQuestions, VisitSections } from "../components/visit-sections";
import { useVisitRecords } from "@/lib/use-visit";

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
it("opens this baby's doctor summary from the appointment", async () => {
  await mount(<VisitSections visit={{ id: "visit", child_id: "mia" }} />);
  await act(async () => { renderer!.root.findAll((n) => String(n.type) === "Row").find((n) => n.props.title === "Doctor summary")!.props.onPress(); });
  expect(mock.push).toHaveBeenCalledWith({ pathname: "/doctor-summary", params: { child: "mia" } });
});
it("keeps a half-typed question and note when she leaves the appointment and comes back", async () => {
  setup([]);
  const visit = { id: "left-and-back", child_id: "mia" }, field = (label: string) => all("Field").find((n) => n.props.label === label)!;
  await mount(<VisitSections visit={visit} />);
  await act(async () => { field("Add a question for the doctor").props.onChange("Is a tarry"); });
  await act(async () => { field("In your words").props.onChange("She said to"); });
  await act(async () => renderer!.unmount());
  await mount(<VisitSections visit={visit} />);
  expect(field("Add a question for the doctor").props.value).toBe("Is a tarry");
  expect(field("In your words").props.value).toBe("She said to");
  await act(async () => renderer!.unmount());
  await mount(<VisitSections visit={{ id: "another-visit", child_id: "mia" }} />);
  expect(field("Add a question for the doctor").props.value).toBe("");
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

describe("a half-typed question when the baby changes", () => {
  const soon = new Date(Date.now() + 86_400_000).toISOString(), forA = { ...appointment("a-visit", soon, "Noa's check"), child_id: "noa" }, forB = { ...appointment("b-visit", soon, "Kai's check"), child_id: "kai" };
  const today = (items: EventOccurrence[]) => <NextVisitQuestions items={items} />, label = "Add a question for the doctor";
  const type = (text: string) => act(async () => { all("Field").find((n) => n.props.label === label)!.props.onChange(text); });
  const value = () => all("Field").find((n) => n.props.label === label)!.props.value;
  const show = (items: EventOccurrence[]) => act(async () => { renderer!.update(today(items)); });
  it("doesn't carry it over to the other baby's appointment, and it's still there on the way back", async () => {
    const b = setup([]);
    await mount(today([forA]));
    await type("Is this rash normal?");
    await show([forB]);
    expect(value()).toBe("");
    expect(all("Button")[0].props.disabled).toBe(true);
    await act(async () => { await all("Button")[0].props.onPress(); });
    expect(b.queue).not.toHaveBeenCalled();
    await show([forA]);
    expect(value()).toBe("Is this rash normal?");
    await act(async () => { await all("Button")[0].props.onPress(); });
    expect(b.state.outbox[0]).toMatchObject({ record: { child_id: "noa", data: { event_id: "a-visit" } } });
  });
  it("gives the input a new identity for each appointment, so nothing the keyboard holds carries over", async () => {
    setup([]);
    await mount(today([forA]));
    const first = all("Field")[0].instance ?? (all("Field")[0] as any)._fiber.key;
    await show([forB]);
    expect((all("Field")[0] as any)._fiber.key).not.toBe(first);
    expect((all("Field")[0] as any)._fiber.key).toContain("b-visit");
  });
  it("saves to the appointment it was typed for even if the screen moves on while it saves, and clears only that one", async () => {
    const b = setup([]);
    let land = () => {};
    b.queue.mockImplementation((change: Mutation) => new Promise<void>((done) => { land = () => { b.state = { ...b.state, outbox: [...b.state.outbox, change] }; done(); }; }));
    await mount(today([forA]));
    await type("For Noa");
    let pressing: Promise<void> | undefined;
    await act(async () => { pressing = all("Button")[0].props.onPress(); });
    await show([forB]);
    await type("For Kai");
    await act(async () => { land(); await pressing; });
    expect(b.state.outbox[0]).toMatchObject({ record: { body: "For Noa", child_id: "noa", data: { event_id: "a-visit" } } });
    expect(value()).toBe("For Kai");
    await show([forA]);
    expect(value()).toBe("");
  });
  it("shows a failure on the appointment that failed", async () => {
    const b = setup([]);
    b.queue.mockRejectedValueOnce(Error("Storage is full."));
    await mount(today([forA]));
    await type("Keep me");
    await act(async () => { await all("Button")[0].props.onPress(); });
    expect(all("Notice")).toHaveLength(1);
    await show([forB]);
    expect(all("Notice")).toHaveLength(0);
    await show([forA]);
    expect(all("Notice")).toHaveLength(1);
  });
  it("keeps it while the other baby has no appointment at all", async () => {
    setup([]);
    function Holder({ items }: { items: EventOccurrence[] }) {
      const drafts = useVisitDrafts();
      return <NextVisitQuestions items={items} drafts={drafts} />;
    }
    await mount(<Holder items={[forA]} />);
    await type("Still here");
    await act(async () => { renderer!.update(<Holder items={[]} />); });
    expect(all("Field")).toHaveLength(0);
    await act(async () => { renderer!.update(<Holder items={[forA]} />); });
    expect(value()).toBe("Still here");
  });
});

describe("which questions fit which visit", () => {
  const person = (id: string, child: string | null, data: BabyRecord["data"] = {}) => ({ ...record(id, "question", data), child_id: child });
  const children = [{ id: "noa", name: "Noa", revision: 1 }, { id: "kai", name: "Kai", revision: 1 }];
  const withChildren = (rows: BabyRecord[]) => { const b = setup(rows); b.state = { ...b.state, bootstrap: { ...b.state.bootstrap!, children } }; return b; };
  it("offers a child's appointment only that child's questions and general ones", async () => {
    withChildren([person("noas", "noa"), person("kais", "kai"), person("general", null)]);
    await mount(<VisitSections visit={{ id: "visit", child_id: "noa" }} />);
    expect(row("noas")).toBeDefined();
    expect(row("general")).toBeDefined();
    expect(row("kais")).toBeUndefined();
  });
  it("offers a family appointment every question and says whose each is", async () => {
    withChildren([person("noas", "noa"), person("kais", "kai"), person("general", null), person("on-it", "kai", { event_id: "visit" })]);
    await mount(<VisitSections visit={{ id: "visit", child_id: null }} />);
    expect(row("noas").props.detail).toBe("For Noa · Tap to add to this visit");
    expect(row("kais").props.detail).toBe("For Kai · Tap to add to this visit");
    expect(row("general").props.detail).toBe("Tap to add to this visit");
    expect(row("on-it").props.detail).toBe("For Kai");
  });
  it("in Journal, links only what fits the next appointment", async () => {
    const b = withChildren([]);
    mock.upcoming = [{ ...appointment("v", new Date(Date.now() + 86_400_000).toISOString()), child_id: "noa" }];
    await mount(<LinkQuestions rows={[person("noas", "noa"), person("kais", "kai"), person("general", null)]} />);
    await act(async () => { await row("Add these 2 questions to OB visit").props.onPress(); });
    expect(b.state.outbox.map((m: any) => m.record.id)).toEqual(["noas", "general"]);
  });
  it("on a question, offers only a visit it fits", async () => {
    withChildren([]);
    mock.upcoming = [{ ...appointment("v", new Date(Date.now() + 86_400_000).toISOString()), child_id: "noa" }];
    await mount(<RecordVisit record={person("kais", "kai")} />);
    expect(renderer!.toJSON()).toBeNull();
  });
});

describe("on an event that isn't an appointment any more", () => {
  const show = async (rows: BabyRecord[]) => { setup(rows); await mount(<VisitLinks visit={{ id: "was" }} />); };
  it("shows what's linked to it, each opening, and nothing to add", async () => {
    await show([record("sleep?", "question", { event_id: "was" }), record("rest", "journal", { event_id: "was", provenance: "clinician_instruction" })]);
    expect(all("Row").map((n) => n.props.title)).toEqual(["sleep?", "rest"]);
    expect(all("Field")).toHaveLength(0);
    await act(async () => row("sleep?").props.onPress());
    expect(mock.push).toHaveBeenCalledWith({ pathname: "/record/[id]", params: { id: "sleep?" } });
  });
  it("reads them, in case this phone hasn't got them yet", async () => {
    await show([]);
    expect(useVisitRecords).toHaveBeenCalledWith("was", true);
  });
  it("shows nothing when nothing's linked, and leaves another visit's alone", async () => {
    await show([record("other", "question", { event_id: "elsewhere" })]);
    expect(all("Copy")).toHaveLength(0);
    expect(all("Row")).toHaveLength(0);
  });
});
