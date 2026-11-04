import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ child: {} as unknown, rows: [] as unknown[], logged: [] as { kind: string; title: string; body: string; data: { label: string } }[], toast: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Linking: { openURL: vi.fn(async () => undefined) }, useWindowDimensions: () => ({ fontScale: 1 }) }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
vi.mock("@/lib/context", () => ({ useBaby: () => ({ state: { bootstrap: { children: [m.child], profile: { timezone: "Pacific/Guam" } }, selectedChild: null } }) }));
vi.mock("@/lib/milestones", () => import("./milestones"));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/quick-care", () => ({
  careWrite: (kind: string, child_id: string, data: unknown, at: Date) => ({ id: "new", kind, title: "Entry", body: "", child_id, data, occurred_at: at.toISOString() }),
  logCare: async (_: unknown, record: never) => { m.logged.push(record); return async () => undefined; },
}));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/today-care", () => ({ useTodayCare: () => ({ all: m.rows, error: "" }) }));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/weekly-content", () => import("./weekly-content"));
vi.mock("@/lib/well-visits", () => import("./well-visits"));
vi.mock("@/components/ui", () => ({
  Button: "Button", Card: "Card", Copy: "Copy", Empty: "Empty", Field: "Field", Grouped: "Grouped", Notice: "Notice", PressTarget: "PressTarget", Row: "Row", Screen: "Screen", Section: "Section",
  tap: () => undefined, useColors: () => ({}), useToast: () => m.toast,
}));
vi.mock("@/components/child-filter", () => ({ ChildFilter: "ChildFilter" }));
vi.mock("@/components/date-field", () => ({ DateField: "DateField" }));
vi.mock("@/components/disclosure", () => ({ Disclosure: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/medical-source", () => ({ MedicalSource: "MedicalSource" }));
vi.mock("@/components/care-glance", () => ({ useMinuteClock: () => new Date("2027-03-10T02:00:00Z") }));
import WellVisits from "../app/well-visits";

let renderer: ReactTestRenderer | undefined;
const mount = () => act(async () => { renderer = create(<WellVisits />); });
const words = () => JSON.stringify(renderer!.toJSON());
const button = (title: string) => renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.title === title)!;
const field = (label: string) => renderer!.root.findAll((n) => String(n.type) === "Field").find((n) => n.props.label === label)!;
const devButton = () => renderer!.root.findAll((n) => String(n.type) === "PressTarget").find((n) => String(n.props.accessibilityLabel).startsWith("Development only"));

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); m.child = { id: "kid", name: "Isla", birth_date: "2027-01-20", due_date: null }; m.rows = []; m.logged = []; m.toast.mockClear(); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("in a release build shows no visit, date or wording of ours while unapproved, and still links both schedules", async () => {
  vi.stubGlobal("__DEV__", false);
  await mount();
  const text = words();
  expect(text).toContain("Visit suggestions are coming once a doctor has reviewed them.");
  expect(text).not.toContain("well visit\"");
  expect(text).not.toContain("Around ");
  expect(text).not.toContain("they differ");
  expect(devButton()).toBeUndefined();
  expect(text).toContain("https://www.healthychildren.org/English/safety-prevention/immunizations/Pages/Recommended-Immunization-Schedules.aspx");
  expect(text).toContain("https://www.cdc.gov/vaccines/hcp/imz-schedules/child-adolescent-age.html");
  expect(text).toContain("does not imply endorsement");
});

it("a development build can preview visits, clearly labelled, and never says missed or overdue", async () => {
  vi.stubGlobal("__DEV__", true);
  await mount();
  await act(async () => devButton()!.props.onPress());
  const text = words();
  expect(text).toContain("Development only. Not reviewed by a doctor.");
  expect(text).toContain("2-month well visit");
  expect(text).toContain("Around March 20, 2027");
  expect(text).not.toMatch(/missed|overdue|late\b|behind/i);
});

it("offers no calendar button until the event path exists", async () => {
  vi.stubGlobal("__DEV__", true);
  await mount();
  await act(async () => devButton()!.props.onPress());
  expect(button("Add to calendar")).toBeUndefined();
});

it("records a shot as a custom entry labelled Shot, with its name, date and note", async () => {
  await mount();
  await act(async () => button("Record a shot").props.onPress());
  await act(async () => button("Save shot").props.onPress());
  expect(m.logged).toHaveLength(0);
  expect(m.toast).toHaveBeenCalledWith("Add the shot’s name.");
  await act(async () => field("Which shot").props.onChange("  Hep B  "));
  await act(async () => field("Note (optional)").props.onChange("Left leg"));
  await act(async () => button("Save shot").props.onPress());
  expect(m.logged[0]).toMatchObject({ kind: "custom", title: "Hep B", body: "Left leg", data: { label: "Shot" } });
});

it("won't take a shot dated before birth or in the future", async () => {
  await mount();
  await act(async () => button("Record a shot").props.onPress());
  await act(async () => field("Which shot").props.onChange("Hep B"));
  const date = () => renderer!.root.findAll((n) => String(n.type) === "DateField")[0];
  await act(async () => date().props.onChange("2027-01-01"));
  await act(async () => button("Save shot").props.onPress());
  await act(async () => date().props.onChange("2027-12-01"));
  await act(async () => button("Save shot").props.onPress());
  expect(m.logged).toHaveLength(0);
});
