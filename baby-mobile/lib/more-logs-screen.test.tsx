import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, type BabyRecord, type DeviceState, type Mutation } from "./models";
import { pendingRecords } from "./outbox";

const scope = vi.hoisted(() => ({ account: null as any, toast: vi.fn(), push: vi.fn(), rows: [] as unknown[], care: {} as Record<string, unknown>, options: [] as any[] }));
vi.mock("react-native", () => ({
  View: "View", Text: "Text", Pressable: "Pressable", TextInput: "TextInput", ScrollView: "ScrollView", useWindowDimensions: () => ({ fontScale: 1 }),
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) }, Alert: { alert() {} },
  AccessibilityInfo: { isScreenReaderEnabled: async () => false, announceForAccessibility() {} },
  Animated: { View: "AnimatedView", Value: class { setValue() {} stopAnimation() {} }, timing: () => ({ start() {} }) },
}));
vi.mock("expo-router", () => ({ router: { push: scope.push }, useFocusEffect: () => undefined }));
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `id-${++id}` }; });
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/today-care", () => ({ useTodayCare: (options: unknown) => { scope.options.push(options); return { all: [...pendingRecords(scope.account.state), ...scope.rows], rows: [], loading: false, error: "", stale: false, refresh: vi.fn(), ...scope.care }; } }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/care-glance", () => import("./care-glance"));
vi.mock("@/lib/feed-timer", () => import("./feed-timer"));
vi.mock("@/lib/running-feed", () => import("./running-feed"));
vi.mock("@/lib/feed-reducer", () => import("./feed-reducer"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/quick-care", () => import("./quick-care"));
vi.mock("@/lib/more-logs", () => import("./more-logs"));
vi.mock("@/lib/trackers", () => import("./trackers"));
vi.mock("../components/date-field", () => ({ DateField: "DateField" }));
vi.mock("../components/motion", () => ({ useReducedMotion: () => false }));
vi.mock("../components/feed-timer", () => ({ useSecondClock: () => new Date() }));
const ui = vi.hoisted(() => ({ PressTarget: "Pressable", Icon: "Icon", Chips: "Chips", easeOut: () => 0, fonts: {}, radii: {}, typeScale: { footnote: {}, caption: {} },
  useColors: () => ({}), useToast: () => scope.toast, tap: () => undefined, Button: "Button", Field: "Field", OnSurface: "OnSurface", KeyboardSave: { Provider: "KeyboardSave" } }));
vi.mock("../components/ui", () => ui);
vi.mock("@/components/ui", () => ui);
import { MoreLogs } from "../components/more-logs";
import { SavedLog, TrackerPanel } from "../components/tracker-panel";
import { useLogFlow } from "../components/quick-log";
import { panelTrackers, trackerById } from "./trackers";

const child = { id: "baby", name: "Mia", revision: 1, birth_date: "2026-11-01" };
let renderer: ReactTestRenderer | undefined;
function setup(change: (state: DeviceState) => DeviceState = (state) => state) {
  const b = {
    get records() { return pendingRecords(b.state); },
    state: change({ ...emptyState(), bootstrap: { generation: 2, active: true, ai_available: false, children: [child], profile: { display_name: "K", timezone: "Pacific/Guam", ai_consent: false } } }) as DeviceState,
    commit: vi.fn(async (next: (state: DeviceState) => DeviceState) => { b.state = next(b.state); }),
    queue: vi.fn(async (m: Mutation) => { b.state = { ...b.state, outbox: [...b.state.outbox, m] }; }),
    sync: vi.fn(async () => undefined),
  };
  scope.account = b;
  return b;
}
const mount = async (pastDay?: { key: string; timezone?: string | null }, stage: "born" | "expecting" = "born") => { await act(async () => { renderer = create(<MoreLogs child={child} now={new Date("2026-11-04T17:00:00.000Z")} pastDay={pastDay} shown={panelTrackers(stage)} />); }); };
const press = async (label: string) => { await act(async () => { renderer!.root.findAll((n) => String(n.type) === "Pressable").find((n) => n.props.accessibilityLabel === label || n.props.accessibilityLabel?.startsWith(`${label},`))!.props.onPress(); }); };
const labels = () => renderer!.root.findAll((n) => String(n.type) === "Pressable").map((n) => n.props.accessibilityLabel);
const type = async (label: string, text: string) => { await act(async () => renderer!.root.findAll((n) => String(n.type) === "Field").find((n) => n.props.label === label)!.props.onChange(text)); };
const save = async (label: string) => { await act(async () => { renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.accessibilityLabel === label)!.props.onPress(); }); };
const saved = () => scope.account.state.outbox.filter((m: Mutation) => m.type === "save").map((m: any) => m.record as BabyRecord);

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); scope.toast.mockReset(); scope.push.mockReset(); scope.rows = []; scope.care = {}; scope.options = []; });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("hands a form's Save to the bar above the keyboard, doing what its own Save does", async () => {
  setup();
  await mount();
  await press("Temperature");
  const bar = renderer!.root.findAll((n) => String(n.type) === "KeyboardSave")[0], save = renderer!.root.findAll((n) => String(n.type) === "Button")[0];
  expect(bar.props.value.label).toBe(save.props.accessibilityLabel);
  await act(async () => bar.props.value.onPress());
  // Nothing typed: it says so in the panel, as its own Save does.
  expect(saved()).toHaveLength(0);
  expect(renderer!.root.findAll((n) => n.props.accessibilityLiveRegion === "polite")).toHaveLength(1);
  await press("Note");
  const note = renderer!.root.findAll((n) => String(n.type) === "KeyboardSave")[0];
  expect(note.props.value.label).toBe("Save note");
});
it("wraps five feelings rather than squeezing them until 'Rough' splits", async () => {
  setup();
  await mount();
  await press("How I’m feeling");
  const rough = renderer!.root.findAll((n) => String(n.type) === "Pressable").find((n) => n.props.accessibilityLabel === "Rough")!;
  expect(Object.assign({}, ...[rough.props.style].flat()).flexBasis).toBe("30%");
});
it("offers each stage its own trackers, from the list", async () => {
  setup();
  await mount();
  // Hers stay available after the birth, after the baby's.
  expect(labels()).toEqual(["Pumping", "Medicine", "Temperature", "Growth", "Note", "Custom", "How I’m feeling", "My weight", "Blood pressure", "Vitamins & medicine"]);
  await act(async () => renderer!.unmount());
  setup();
  await mount(undefined, "expecting");
  expect(labels()).toEqual(["How I’m feeling", "My weight", "Blood pressure", "Vitamins & medicine"]);
});
it("shows nothing with nothing to show, and sends a tile with no panel where it goes", async () => {
  setup();
  await act(async () => { renderer = create(<MoreLogs child={child} now={new Date()} shown={[]} />); });
  expect(renderer!.toJSON()).toBeNull();
  await act(async () => renderer!.unmount());
  setup();
  await act(async () => { renderer = create(<MoreLogs child={child} now={new Date()} shown={[trackerById("kicks")!, trackerById("diaper")!]} />); });
  await press("Kick counter");
  expect(scope.push).toHaveBeenLastCalledWith("/kicks");
  await press("Diaper");
  expect(scope.push).toHaveBeenLastCalledWith({ pathname: "/add", params: { open: "diaper" } });
});

it("opens the same panel away from Today: a host needs only the flow, and it saves with Undo", async () => {
  const b = setup();
  function Add() {
    const flow = useLogFlow<string>();
    return <><SavedLog flow={flow} now={new Date()} /><TrackerPanel tracker={trackerById("pumping")!} child={child} now={new Date()} flow={flow} /></>;
  }
  await act(async () => { renderer = create(<Add />); });
  await press("Right");
  expect(saved()[0]).toMatchObject({ kind: "pumping", child_id: "baby", data: { side: "right", amount: 3, unit: "oz" } });
  await press("Undo Pumping, Right, 3 oz");
  expect(pendingRecords(b.state).filter((row) => row.kind === "pumping")).toEqual([]);
});

it("logs what she says about herself with no baby on it, and adds nothing to her numbers", async () => {
  setup();
  await mount(undefined, "expecting");
  await press("How I’m feeling");
  await press("Tired");
  expect(saved()[0]).toMatchObject({ kind: "custom", child_id: null, title: "Tired", data: { label: "How I'm feeling" } });
  await press("My weight");
  await type("Weight", "145.5");
  await save("Save my weight");
  expect(saved()[1]).toMatchObject({ kind: "custom", child_id: null, title: "My weight", data: { label: "My weight", value: 145.5, unit: "lb" } });
  await press("Blood pressure");
  await type("Top number", "190");
  await type("Bottom number", "120");
  await save("Save blood pressure");
  expect(saved()[2]).toMatchObject({ kind: "custom", child_id: null, title: "190/120", data: { label: "Blood pressure" } });
  expect(JSON.stringify(renderer!.toJSON())).not.toMatch(/high|normal|low\b|call|doctor|worry|range|hospital/i);
  await press("Vitamins & medicine");
  await type("What you took", "Prenatal");
  await save("Save vitamins & medicine");
  expect(saved()[3]).toMatchObject({ kind: "custom", child_id: null, title: "Prenatal", data: { label: "Vitamins and medicine" } });
  await press("Vitamins & medicine");
  await press("Prenatal");
  expect(saved()[4]).toMatchObject({ title: "Prenatal", child_id: null });
});

it("logs pumping in two taps, at now, with its baby, and Undo takes it back", async () => {
  const b = setup();
  await mount();
  const before = Date.now();
  await press("Pumping");
  await press("Left");
  const [record] = saved();
  expect(record).toMatchObject({ kind: "pumping", child_id: "baby", title: "Pumping", data: { side: "left", amount: 3, unit: "oz" } });
  expect(new Date(record.occurred_at).getTime()).toBeGreaterThanOrEqual(before);
  expect(b.queue).toHaveBeenCalledTimes(1);
  // Still here, ready for the next one: no save-and-go-back.
  expect(labels()).toContain("Medicine");
  expect(scope.push).not.toHaveBeenCalled();
  await press("Undo Pumping, Left, 3 oz");
  expect(pendingRecords(b.state).filter((row) => row.kind === "pumping")).toEqual([]);
});

it("fills the form from a medicine she has given before, and only Save records the dose", async () => {
  const field = (label: string) => renderer!.root.findAll((n) => String(n.type) === "Field").find((n) => n.props.label === label)!.props;
  setup();
  await mount();
  await press("Medicine");
  await type("Name", "Vitamin D");
  await type("Dose (optional)", "1 mL");
  await save("Save medicine");
  expect(saved()).toHaveLength(1);
  expect(saved()[0]).toMatchObject({ kind: "medicine", title: "Vitamin D", data: { name: "Vitamin D", dose: "1 mL" } });
  await press("Medicine");
  await press("Vitamin D");
  // A half-asleep tap can't be a second dose.
  expect(saved()).toHaveLength(1);
  expect(field("Name").value).toBe("Vitamin D");
  expect(field("Dose (optional)").value).toBe("1 mL");
  const words = JSON.stringify(renderer!.toJSON());
  expect(words).toContain("1 mL · Last");
  await save("Save medicine");
  expect(saved()).toHaveLength(2);
  expect(saved()[1]).toMatchObject({ kind: "medicine", title: "Vitamin D", data: { name: "Vitamin D", dose: "1 mL" } });
});
it("lets her change the dose a chip filled in, and a typed name replaced by another chip keeps nothing of the first", async () => {
  const field = (label: string) => renderer!.root.findAll((n) => String(n.type) === "Field").find((n) => n.props.label === label)!.props;
  setup();
  scope.rows = [
    { id: "a", kind: "medicine", title: "Vitamin D", body: "", child_id: "baby", occurred_at: "2026-11-04T01:00:00.000Z", revision: 1, data: { name: "Vitamin D", dose: "1 mL" } },
    { id: "b", kind: "medicine", title: "Tylenol", body: "", child_id: "baby", occurred_at: "2026-11-03T01:00:00.000Z", revision: 1, data: { name: "Tylenol" } },
  ] as any;
  await mount();
  await press("Medicine");
  await press("Vitamin D");
  await type("Dose (optional)", "2 mL");
  await save("Save medicine");
  expect(saved()[0]).toMatchObject({ title: "Vitamin D", data: { name: "Vitamin D", dose: "2 mL" } });
  await press("Medicine");
  await press("Vitamin D");
  await press("Tylenol");
  expect(field("Name").value).toBe("Tylenol");
  expect(field("Dose (optional)").value).toBe("");
});

it("says what's wrong with a temperature, saves nothing, and adds no reading of it", async () => {
  setup();
  await mount();
  await press("Temperature");
  await type("Temperature", "37");
  await save("Save temperature");
  expect(saved()).toEqual([]);
  expect(JSON.stringify(renderer!.toJSON())).toContain("Check the number and whether it’s °F or °C.");
  await type("Temperature", "100.4");
  await save("Save temperature");
  expect(saved()[0]).toMatchObject({ kind: "temperature", data: { value: 100.4, unit: "f" } });
  expect(JSON.stringify(renderer!.toJSON())).not.toMatch(/fever|high|normal|call|doctor|worry/i);
});

it("keeps a note in the body of a custom entry labelled Note, and a custom log under her own words", async () => {
  setup();
  await mount();
  await press("Note");
  await save("Save note");
  expect(saved()).toEqual([]);
  expect(JSON.stringify(renderer!.toJSON())).toContain("Write the note first.");
  await type("What to remember", "Spit up after the morning feed");
  await save("Save note");
  expect(saved()[0]).toMatchObject({ kind: "custom", title: "Note", body: "Spit up after the morning feed", data: { label: "Note" } });
  await press("Custom");
  await type("What is it?", "Tummy time");
  await save("Save custom");
  expect(saved()[1]).toMatchObject({ kind: "custom", title: "Tummy time", data: { label: "Tummy time" } });
  expect(renderer!.root.findAll((n) => n.props.accessibilityLabel === "Medicine").length).toBeGreaterThan(0);
});

it("on another day asks when before saving anything", async () => {
  setup();
  await mount({ key: "2026-11-02", timezone: "Pacific/Guam" });
  await press("Pumping");
  await press("Right");
  expect(saved()).toEqual([]);
  expect(JSON.stringify(renderer!.toJSON())).toContain("Choose a time first.");
  await press("8 AM");
  await press("Right");
  expect(saved()[0].occurred_at).toBe("2026-11-01T22:00:00.000Z");
});

describe("from the review of #543", () => {
  const dose = (name: string, at: string, doseText?: string) => ({ id: `${name}-${at}`, kind: "medicine", title: name, body: "", child_id: "baby", occurred_at: at, data: { name, ...(doseText ? { dose: doseText } : {}) }, revision: 1, created_at: at, updated_at: at });
  // 4:14 PM on the phone in Honolulu is 12:14 PM the next day in Guam: only the "ago" is true on both.
  const now = new Date("2026-11-04T17:00:00.000Z");
  it("2: says how long ago as well as when, so a Last can be trusted on any clock", async () => {
    setup();
    scope.rows = [dose("Tylenol", "2026-11-04T15:00:00.000Z", "2.5 mL")];
    await mount();
    await press("Medicine");
    const chip = labels().find((label) => label?.startsWith("Tylenol"));
    expect(chip).toContain("2.5 mL");
    expect(chip).toContain("1:00 AM"); // Guam's clock, as Tracker reads.
    expect(chip?.replace(/\u00a0/g, " ")).toContain("2 h ago");
  });
  it("3: says when it can't reach the service, and keeps looking while the panel is open", async () => {
    setup();
    await mount();
    await press("Medicine");
    const panel = scope.options.at(-1);
    expect(panel).toMatchObject({ poll: true, kinds: ["medicine"], child: "baby" });
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("on this phone");
    scope.care = { error: "No connection" };
    await act(async () => renderer!.update(<MoreLogs child={child} now={now} shown={panelTrackers("born")} />));
    expect(JSON.stringify(renderer!.toJSON())).toContain("Showing what’s on this phone");
    scope.care = { stale: true };
    await act(async () => renderer!.update(<MoreLogs child={child} now={now} shown={panelTrackers("born")} />));
    expect(JSON.stringify(renderer!.toJSON())).toContain("Showing what’s on this phone");
    scope.care = {};
    scope.account.online = false;
    await act(async () => renderer!.update(<MoreLogs child={child} now={now} shown={panelTrackers("born")} />));
    expect(JSON.stringify(renderer!.toJSON())).toContain("Showing what’s on this phone");
  });
  it("5: shows the Last of a medicine she types, even one not offered as a chip", async () => {
    setup();
    scope.rows = [dose("A", "2026-11-04T16:00:00.000Z"), dose("B", "2026-11-04T15:50:00.000Z"), dose("C", "2026-11-04T15:40:00.000Z"), dose("Gas drops", "2026-11-04T15:00:00.000Z", "0.3 mL")];
    await mount();
    await press("Medicine");
    expect(labels().some((label) => label?.startsWith("Gas drops"))).toBe(false);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("0.3 mL");
    await type("Name", "gas drops");
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain("0.3 mL");
    expect(text.replace(/\u00a0/g, " ")).toContain("2 h ago");
  });
  it("10: names the baby in the panel and the saved row when there's more than one", async () => {
    setup((state) => ({ ...state, bootstrap: { ...state.bootstrap!, children: [child, { id: "two", name: "Noa", revision: 1 }] } }));
    await mount();
    await press("Pumping");
    expect(JSON.stringify(renderer!.toJSON())).toContain("For Mia");
    await press("Left");
    expect(labels()).toContain("Undo Pumping, Left, 3 oz, for Mia");
  });
  it("10: doesn't name a baby with only one, or on her own logs", async () => {
    setup((state) => ({ ...state, bootstrap: { ...state.bootstrap!, children: [child, { id: "two", name: "Noa", revision: 1 }] } }));
    await mount(undefined, "expecting");
    await press("Blood pressure");
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("For Mia");
    await act(async () => renderer!.unmount());
    setup();
    await mount();
    await press("Pumping");
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("For Mia");
  });
  it("18: a picked time ahead of now becomes now", async () => {
    setup();
    await mount();
    const before = Date.now();
    await press("Pumping");
    await press("Change time, Now");
    await press("Pick a time");
    await act(async () => renderer!.root.findByType("DateField" as never).props.onChange(new Date(Date.now() + 5 * 3600_000).toISOString()));
    await press("Left");
    expect(new Date(saved()[0].occurred_at).getTime()).toBeLessThan(before + 60_000);
  });
});

describe("from the re-check of #543", () => {
  const now = new Date("2026-11-04T17:00:00.000Z");
  const other = { id: "other", name: "Noa", revision: 1, birth_date: "2026-11-01" };
  const history = (kind: string, data: object) => ({ id: "history", kind, title: kind, body: "", child_id: "baby", occurred_at: "2026-11-04T15:00:00Z", data, revision: 1, created_at: "", updated_at: "" });
  const again = (who = child) => act(async () => renderer!.update(<MoreLogs child={who} now={now} shown={panelTrackers("born")} />));
  it("High: a medicine typed for one baby can't be saved on another after switching", async () => {
    setup();
    await mount();
    await press("Medicine");
    await type("Name", "Draft meant for Mia");
    await again(other);
    await save("Save medicine");
    expect(saved()).toEqual([]);
    expect(renderer!.root.findAll((n) => String(n.type) === "Field").find((n) => n.props.label === "Name")!.props.value).toBe("");
  });
  it("High: an amount set for one baby isn't what gets saved for the other", async () => {
    setup();
    await mount();
    await press("Pumping");
    await press("More");
    await again(other);
    await press("Left");
    expect(saved()[0]).toMatchObject({ child_id: "other", data: { amount: 3 } });
  });
  it("High: a time picked for one baby doesn't carry to the other", async () => {
    setup();
    await mount();
    await press("Pumping");
    await press("Change time, Now");
    await press("5 min ago");
    await again(other);
    const before = Date.now();
    await press("Left");
    expect(new Date(saved()[0].occurred_at).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
  it("High: her own log keeps what she typed when the baby on screen changes, since it isn't that baby's", async () => {
    setup();
    await mount(undefined, "expecting");
    await press("My weight");
    await type("Weight", "145.5");
    await act(async () => renderer!.update(<MoreLogs child={other} now={now} shown={panelTrackers("expecting")} />));
    await save("Save my weight");
    expect(saved()[0]).toMatchObject({ child_id: null, data: { value: 145.5 } });
  });
  it("pumping can go down to 5 mL and 0.25 oz", async () => {
    setup();
    scope.rows = [history("pumping", { side: "both", amount: 20, unit: "ml" })];
    await mount();
    await press("Pumping");
    await press("Less");
    await press("Less");
    await press("Less");
    await press("Less");
    await press("Left");
    expect(saved()[0].data).toMatchObject({ amount: 5, unit: "ml" });
    await act(async () => renderer!.unmount());
    setup();
    scope.rows = [history("pumping", { side: "both", amount: 0.75, unit: "oz" })];
    await mount();
    await press("Pumping");
    await press("Less");
    await press("Less");
    await press("Less");
    await press("Left");
    expect(saved()[0].data).toMatchObject({ amount: 0.25, unit: "oz" });
  });
  it("a bottle keeps its coarser steps", async () => {
    const { stepAmount } = await import("./quick-care");
    expect(stepAmount({ amount: 20, unit: "ml" }, -1)).toBe(10);
    expect(stepAmount({ amount: 10, unit: "ml" }, -1)).toBe(10);
    expect(stepAmount({ amount: 1, unit: "oz" }, -1)).toBe(0.5);
  });
  it("history arriving after the panel opens seeds an untouched amount", async () => {
    setup();
    await mount();
    await press("Pumping");
    scope.rows = [history("pumping", { side: "both", amount: 35, unit: "ml" })];
    await again();
    await press("Left");
    expect(saved()[0].data).toMatchObject({ amount: 35, unit: "ml" });
  });
  it("history arriving after the panel opens leaves an amount she changed alone", async () => {
    setup();
    await mount();
    await press("Pumping");
    await press("More");
    scope.rows = [history("pumping", { side: "both", amount: 35, unit: "ml" })];
    await again();
    await press("Left");
    expect(saved()[0].data).toMatchObject({ amount: 3.25, unit: "oz" });
  });
  it("history arriving after the panel opens seeds an untouched temperature scale", async () => {
    setup();
    await mount();
    await press("Temperature");
    scope.rows = [history("temperature", { value: 37, unit: "c" })];
    await again();
    await type("Temperature", "37.5");
    await save("Save temperature");
    expect(saved()[0]?.data).toMatchObject({ value: 37.5, unit: "c" });
  });
  it("history arriving after she typed leaves what she typed alone", async () => {
    setup();
    await mount();
    await press("Temperature");
    await type("Temperature", "99.1");
    scope.rows = [history("temperature", { value: 37, unit: "c" })];
    await again();
    await save("Save temperature");
    expect(saved()[0]?.data).toMatchObject({ value: 99.1, unit: "f" });
  });
  it("replacing one open panel with another brings the new one into view", async () => {
    setup();
    const onOpen = vi.fn();
    await act(async () => { renderer = create(<MoreLogs child={child} now={now} shown={panelTrackers("born")} onOpen={onOpen} />); });
    await press("Growth");
    onOpen.mockClear();
    await press("Medicine");
    expect(onOpen).toHaveBeenCalledWith(true, expect.any(Number));
  });
});
