import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, type BabyRecord, type DeviceState, type Mutation } from "./models";
import { pendingRecords } from "./outbox";

const scope = vi.hoisted(() => ({ account: null as any, toast: vi.fn(), push: vi.fn(), rows: [] as unknown[] }));
vi.mock("react-native", () => ({
  View: "View", Text: "Text", Pressable: "Pressable", TextInput: "TextInput", ScrollView: "ScrollView", useWindowDimensions: () => ({ fontScale: 1 }),
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) }, Alert: { alert() {} },
  AccessibilityInfo: { isScreenReaderEnabled: async () => false, announceForAccessibility() {} },
  Animated: { View: "AnimatedView", Value: class { setValue() {} stopAnimation() {} }, timing: () => ({ start() {} }) },
}));
vi.mock("expo-router", () => ({ router: { push: scope.push }, useFocusEffect: () => undefined }));
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `id-${++id}` }; });
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/today-care", () => ({ useTodayCare: () => ({ all: pendingRecords(scope.account.state), rows: [], loading: false, error: "", refresh: vi.fn() }) }));
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
  useColors: () => ({}), useToast: () => scope.toast, tap: () => undefined, Button: "Button", Field: "Field", OnSurface: "OnSurface" }));
vi.mock("../components/ui", () => ui);
vi.mock("@/components/ui", () => ui);
import { MoreLogs } from "../components/more-logs";
import { SavedLog, TrackerPanel } from "../components/tracker-panel";
import { useLogFlow } from "../components/quick-log";
import { trackerById } from "./trackers";

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
const mount = async (pastDay?: { key: string; timezone?: string | null }, stage: "born" | "expecting" = "born") => { await act(async () => { renderer = create(<MoreLogs child={child} now={new Date("2026-11-04T17:00:00.000Z")} pastDay={pastDay} stage={stage} />); }); };
const press = async (label: string) => { await act(async () => { renderer!.root.findAll((n) => String(n.type) === "Pressable").find((n) => n.props.accessibilityLabel === label || n.props.accessibilityLabel?.startsWith(`${label},`))!.props.onPress(); }); };
const labels = () => renderer!.root.findAll((n) => String(n.type) === "Pressable").map((n) => n.props.accessibilityLabel);
const type = async (label: string, text: string) => { await act(async () => renderer!.root.findAll((n) => String(n.type) === "Field").find((n) => n.props.label === label)!.props.onChange(text)); };
const save = async (label: string) => { await act(async () => { renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.accessibilityLabel === label)!.props.onPress(); }); };
const saved = () => scope.account.state.outbox.filter((m: Mutation) => m.type === "save").map((m: any) => m.record as BabyRecord);

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); scope.toast.mockReset(); scope.push.mockReset(); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("offers each stage its own trackers, from the list", async () => {
  setup();
  await mount();
  expect(labels()).toEqual(["Pumping", "Medicine", "Temperature", "Growth", "Note", "Custom"]);
  await act(async () => renderer!.unmount());
  setup();
  await mount(undefined, "expecting");
  expect(labels()).toEqual(["How I’m feeling", "My weight", "Blood pressure", "Vitamins & medicine"]);
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

it("logs a medicine she has given before in one tap more", async () => {
  setup();
  await mount();
  await press("Medicine");
  await type("Name", "Vitamin D");
  await type("Dose (optional)", "1 mL");
  await save("Save medicine");
  expect(saved()[0]).toMatchObject({ kind: "medicine", title: "Vitamin D", data: { name: "Vitamin D", dose: "1 mL" } });
  await press("Medicine");
  await press("Vitamin D");
  expect(saved()[1]).toMatchObject({ kind: "medicine", title: "Vitamin D", data: { name: "Vitamin D", dose: "1 mL" } });
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
