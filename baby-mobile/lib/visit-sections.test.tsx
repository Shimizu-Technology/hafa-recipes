import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type EventOccurrence, type Mutation } from "./models";

const mock = vi.hoisted(() => ({ baby: null as any, focuses: new Set<() => void>(), upcoming: [] as any[], push: vi.fn(), toast: vi.fn(), ids: 0 }));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("expo-router", () => ({ router: { push: mock.push }, useFocusEffect: (fn: () => void) => React.useEffect(() => { mock.focuses.add(fn); fn(); return () => { mock.focuses.delete(fn); }; }, [fn]) }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `id-${++mock.ids}` }));
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
vi.mock("./context", () => ({ useBaby: () => mock.baby }));
vi.mock("@/lib/events", () => import("./events"));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/visits", () => import("./visits"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/use-visit", async () => ({ ...await vi.importActual<typeof import("./use-visit")>("./use-visit"), useVisitRecords: vi.fn() }));
vi.mock("@/lib/use-events", () => ({ useUpcomingEvents: () => ({ items: mock.upcoming }) }));
const ui = vi.hoisted(() => ({ Button: "Button", Choice: "Choice", Copy: "Copy", Field: "Field", Grouped: "Grouped", Notice: "Notice", Row: "Row", tap: vi.fn(), useToast: () => mock.toast }));
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
    current: () => true, api: { record: vi.fn(async (id: string) => record(id, "event", { category: "appointment", timezone: guam })), lease: () => ({}), assertLease: vi.fn() }, sync: vi.fn(async () => undefined), commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { account.state = change(account.state); }),
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
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(console, "error").mockImplementation(() => undefined); vi.clearAllMocks(); mock.ids = 0; mock.upcoming = []; mock.focuses.clear(); });
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
  b.commit.mockRejectedValue(Error("Storage is full."));
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
  const prepared = () => setup([...[forA, forB].map((visit) => ({ ...record(visit.event_id, "event", { category: "appointment", timezone: guam }), child_id: visit.child_id }))]);
  const today = (items: EventOccurrence[]) => <NextVisitQuestions items={items} />, label = "Add a question for the doctor";
  const type = (text: string) => act(async () => { all("Field").find((n) => n.props.label === label)!.props.onChange(text); });
  const value = () => all("Field").find((n) => n.props.label === label)!.props.value;
  const show = (items: EventOccurrence[]) => act(async () => { renderer!.update(today(items)); });
  it("doesn't carry it over to the other baby's appointment, and it's still there on the way back", async () => {
    const b = prepared();
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
    prepared();
    await mount(today([forA]));
    const first = all("Field")[0].instance ?? (all("Field")[0] as any)._fiber.key;
    await show([forB]);
    expect((all("Field")[0] as any)._fiber.key).not.toBe(first);
    expect((all("Field")[0] as any)._fiber.key).toContain("b-visit");
  });
  it("saves to the appointment it was typed for even if the screen moves on while it saves, and clears only that one", async () => {
    const b = prepared();
    let land = () => {};
    b.commit.mockImplementation((change: (s: DeviceState) => DeviceState) => new Promise<void>((done) => { land = () => { b.state = change(b.state); done(); }; }));
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
    const b = prepared();
    b.commit.mockRejectedValueOnce(Error("Storage is full."));
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
    prepared();
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


describe("family visit capture", () => {
  const visit = { ...record("family-visit", "event"), space_id: "f", child_id: "baby", occurred_at: "2026-11-04T00:00:00Z" };
  function family(role = "parent") {
    const b = setup([visit]); b.owner = expect.getState().currentTestName;
    Object.assign(b.state.bootstrap, { personal_space_id: "p", children: [{ id: "baby", name: "Baby", space_id: "f" }], spaces: [{ id: "p", kind: "personal", generation: 1 }, { id: "f", kind: "family", role, generation: 2 }] });
    return b;
  }
  it("defaults to a private journal on the visit day without a cross-space link", async () => {
    const b = family(); await mount(<VisitSections visit={visit} />);
    await add("In your words", "Save this note", "My own words");
    expect(b.state.outbox[0]).toMatchObject({ space_id: "p", record: { kind: "journal", child_id: "baby", occurred_at: visit.occurred_at, data: { event_id: null } } });
    expect(mock.toast).toHaveBeenCalledWith(expect.stringContaining("Not attached"));
  });
  it("shares only after the writer chooses to share that box", async () => {
    const b = family(); await mount(<VisitSections visit={visit} />);
    const choices = all("Choice").filter((n) => n.props.label === "Share with the family on this visit");
    await act(async () => choices[1].props.onPress());
    await add("In your words", "Save this note", "For our family");
    expect(b.state.outbox[0]).toMatchObject({ space_id: "f", generation: 2, record: { kind: "journal", data: { event_id: visit.id } } });
    await act(async () => all("Choice").filter((n) => n.props.label === "Keep to myself")[0].props.onPress());
    await add("Add a question for the doctor", "Add question", "Private question");
    expect(b.state.outbox[1]).toMatchObject({ space_id: "p", record: { kind: "question", child_id: null, title: "Question for Baby", data: { event_id: null } } });
  });
  it("defaults questions Shared, keeps each choice after Save, and resets empty boxes on returning", async () => {
    const b = family(); await mount(<VisitSections visit={visit} />);
    const shared = () => all("Choice").filter((n) => n.props.label === "Share with the family on this visit");
    expect(shared()[0].props.selected).toBe(true); expect(shared()[1].props.selected).toBe(false);
    await add("Add a question for the doctor", "Add question", "Shared question");
    expect(b.state.outbox[0]).toMatchObject({ space_id: "f", record: { kind: "question", data: { event_id: visit.id } } });
    await act(async () => shared()[1].props.onPress());
    await add("In your words", "Save this note", "Shared once");
    expect(shared()[1].props.selected).toBe(true);
    await act(async () => { for (const focus of mock.focuses) focus(); });
    expect(shared()[1].props.selected).toBe(false);
    expect(shared()[0].props.selected).toBe(true);
  });
  it.each(["visit", "Today"])("keeps a private question choice with its words across focus on %s", async (screen) => {
    const b = family(), upcoming = { ...appointment(visit.id, new Date(Date.now() + 86400000).toISOString()), child_id: "baby" };
    await mount(screen === "visit" ? <VisitSections visit={visit} /> : <NextVisitQuestions items={[upcoming]} />);
    const field = () => all("Field").find((n) => n.props.label === "Add a question for the doctor")!;
    await act(async () => field().props.onChange("Sensitive private question"));
    await act(async () => all("Choice").filter((n) => n.props.label === "Keep to myself")[0].props.onPress());
    await act(async () => { for (const focus of mock.focuses) focus(); });
    expect(field().props.value).toBe("Sensitive private question");
    expect(all("Choice").filter((n) => n.props.label === "Keep to myself")[0].props.selected).toBe(true);
    await act(async () => { await field().props.onSubmit(); });
    expect(b.state.outbox[0].space_id).toBe("p");
    await add("Add a question for the doctor", "Add question", "Second private question");
    expect(b.state.outbox[1].space_id).toBe("p");
    await act(async () => { for (const focus of mock.focuses) focus(); });
    expect(all("Choice").filter((n) => n.props.label === "Share with the family on this visit")[0].props.selected).toBe(true);
  });
  it("keeps a chosen shared note with its words across focus and after Save, then resets an empty box", async () => {
    const b = family(); await mount(<VisitSections visit={visit} />);
    const shared = () => all("Choice").filter((n) => n.props.label === "Share with the family on this visit")[1];
    await act(async () => shared().props.onPress());
    await act(async () => all("Field").find((n) => n.props.label === "In your words")!.props.onChange("Chosen shared note"));
    await act(async () => { for (const focus of mock.focuses) focus(); });
    expect(shared().props.selected).toBe(true);
    await act(async () => { await all("Button").find((n) => n.props.title === "Save this note")!.props.onPress(); });
    await add("In your words", "Save this note", "Second shared note");
    expect(b.state.outbox.slice(-2).map((m: Mutation) => m.space_id)).toEqual(["f", "f"]);
    await act(async () => { for (const focus of mock.focuses) focus(); });
    expect(shared().props.selected).toBe(false);
  });
  it("restores the privacy choice when a visit with typed words remounts", async () => {
    const b = family(); await mount(<VisitSections visit={visit} />);
    await act(async () => all("Field").find((n) => n.props.label === "Add a question for the doctor")!.props.onChange("Keep this private after remount"));
    await act(async () => all("Choice").filter((n) => n.props.label === "Keep to myself")[0].props.onPress());
    await act(async () => renderer!.unmount()); await mount(<VisitSections visit={visit} />);
    expect(all("Choice").filter((n) => n.props.label === "Keep to myself")[0].props.selected).toBe(true);
    await act(async () => { await all("Button").find((n) => n.props.title === "Add question")!.props.onPress(); });
    expect(b.state.outbox[0]).toMatchObject({ space_id: "p", record: { kind: "question", child_id: null } });
  });
  it("uses series wording for both capture choices and the private confirmation", async () => {
    const b = family(), repeating = { ...visit, data: { recurrence: { frequency: "weekly" as const } } }; b.state.records = [repeating];
    await mount(<VisitSections visit={repeating} />);
    expect(all("Choice").filter((n) => n.props.label === "Share with the family in this series")).toHaveLength(2);
    await act(async () => all("Choice").filter((n) => n.props.label === "Keep to myself")[0].props.onPress());
    await add("Add a question for the doctor", "Add question", "Private series question");
    expect(mock.toast).toHaveBeenCalledWith("Saved on this phone in Journal. Not attached to the shared series.");
  });
  it("narrows an in-progress shared note after a caregiver downgrade without widening it on return", async () => {
    const b = family(); await mount(<VisitSections visit={visit} />);
    await act(async () => all("Choice").filter((n) => n.props.label === "Share with the family on this visit")[1].props.onPress());
    await act(async () => all("Field").find((n) => n.props.label === "In your words")!.props.onChange("Words kept through a role change"));
    b.state.bootstrap.spaces.find((space: any) => space.id === "f").role = "caregiver";
    await act(async () => renderer!.update(<VisitSections visit={visit} />));
    await act(async () => { await all("Button").find((n) => n.props.title === "Save this note")!.props.onPress(); });
    expect(b.state.outbox[0]?.space_id).toBe("p");
    b.state.bootstrap.spaces.find((space: any) => space.id === "f").role = "parent";
    await act(async () => renderer!.update(<VisitSections visit={visit} />));
    expect(all("Choice").filter((n) => n.props.label === "Keep to myself")[1].props.selected).toBe(true);
  });
  it("preserves a caregiver's permitted question capture on their own personal visit", async () => {
    const b = family("caregiver"), personal = { ...visit, id: "personal-visit", space_id: "p", child_id: null };
    b.state.records.push(personal);
    await mount(<VisitQuestions visit={personal} />);
    await add("Add a question for the doctor", "Add question", "For my own visit");
    expect(b.state.outbox[0]).toMatchObject({ space_id: "p", record: { kind: "question", data: { event_id: personal.id } } });
  });
  it("doesn't offer a caregiver shared writing or doctor-question capture", async () => {
    const b = family("caregiver"); await mount(<VisitSections visit={visit} />);
    expect(all("Choice")).toHaveLength(0);
    expect(all("Field").some((n) => n.props.label === "Add a question for the doctor")).toBe(false);
    await add("In your words", "Save this note", "My private note");
    expect(b.state.outbox[0]).toMatchObject({ space_id: "p", record: { kind: "journal", data: { event_id: null } } });
  });
});

it("does not offer a cross-space saved question on Today, in LinkQuestions, or in RecordVisit", async () => {
  const event = { ...record("family-v", "event"), space_id: "f" }, q = { ...record("private-q", "question"), space_id: "p" }, upcoming = appointment(event.id, new Date(Date.now() + 86400000).toISOString());
  setup([event, q]); mock.upcoming = [upcoming];
  await mount(<LinkQuestions rows={[q]} />); expect(all("Row")).toHaveLength(0);
  await act(async () => renderer!.unmount());
  await mount(<RecordVisit record={q} />); expect(all("Row")).toHaveLength(0);
  await act(async () => renderer!.unmount());
  const b = mock.baby;
  Object.assign(b.state.bootstrap, { personal_space_id: "p", spaces: [{ id: "p", kind: "personal", generation: 1 }, { id: "f", kind: "family", role: "parent", generation: 1 }] });
  await mount(<NextVisitQuestions items={[upcoming]} />);
  await add("Add a question for the doctor", "Add question", "On Today");
  expect(b.state.outbox[0]).toMatchObject({ space_id: "f", record: { kind: "question", data: { event_id: event.id } } });
});

it.each(["today", "journal", "record"])("resolves an uncached event before %s capture or linking", async (screen) => {
  const question = { ...record("q", "question"), space_id: "f" }, event = { ...record("visit", "event", { category: "appointment", timezone: guam }), space_id: "f" }, b = setup([question]);
  b.current = () => true; b.api = { record: vi.fn(async () => event), lease: () => ({}), assertLease: vi.fn() };
  b.state.bootstrap = { ...b.state.bootstrap, personal_space_id: "p", spaces: [{ id: "p", kind: "personal", role: "parent", generation: 1 }, { id: "f", kind: "family", role: "parent", generation: 1 }] };
  mock.upcoming = [appointment("visit", "2099-11-08T00:00:00Z")];
  await mount(screen === "today" ? <NextVisitQuestions items={mock.upcoming} /> : screen === "journal" ? <LinkQuestions rows={[question]} /> : <RecordVisit record={question} />);
  expect(b.api.record).toHaveBeenCalledWith("visit");
  if (screen === "today") { await add("Add a question for the doctor", "Add question", "saved from Today"); expect(b.state.outbox[0]).toMatchObject({ space_id: "f", record: { data: { event_id: "visit" } } }); }
  else expect(all("Row").some((node) => String(node.props.title).startsWith("Add "))).toBe(true);
});

it("carries a queued local attachment when linking before its first upload", async () => {
  const question = record("q", "question"), b = setup([record("visit", "event")]), file = { id: "picked", uri: "file:///not-uploaded.jpg" };
  b.state.outbox = [{ id: "first", type: "save", generation: 1, record: question, files: [file] }];
  mock.upcoming = [appointment("visit", "2099-11-08T00:00:00Z")]; await mount(<LinkQuestions rows={[question]} />);
  await act(async () => { await row("Add this question to OB visit").props.onPress(); });
  expect(b.state.outbox.at(-1).files).toEqual([file]);
});
