import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../components/health-note", () => ({ HealthNote: "HealthNote" }));
import type { BabyRecord, Child } from "./models";

const m = vi.hoisted(() => ({ rows: [] as unknown[], child: {} as unknown, logged: [] as { record: { kind: string; title: string; child_id: string; data: { milestone_id: string } } }[], undone: 0, amended: 0, toast: vi.fn(), push: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Linking: { openURL: vi.fn(async () => undefined) }, useWindowDimensions: () => ({ fontScale: 1 }) }));
vi.mock("expo-router", () => ({ router: { push: m.push } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
vi.mock("@/lib/context", () => ({ useBaby: () => ({ state: { bootstrap: { children: [m.child], profile: { timezone: "Pacific/Guam" } }, selectedChild: null } }) }));
vi.mock("@/lib/milestones", () => import("./milestones"));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/quick-care", () => ({
  careWrite: (kind: string, child_id: string, data: unknown, at: Date) => ({ id: "new", kind, title: "Milestone", body: "", child_id, data, occurred_at: at.toISOString() }),
  logCare: async (_: unknown, record: never) => { m.logged.push({ record }); return async () => { m.undone++; }; },
  amendCare: async () => { m.amended++; }, undoSaved: () => async () => { m.undone++; },
}));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/today-care", () => ({ useTodayCare: () => ({ all: m.rows, error: "" }) }));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/components/ui", () => ({
  Button: "Button", Card: "Card", Copy: "Copy", Empty: "Empty", FilterChips: "FilterChips", Grouped: "Grouped", Icon: "Icon", Notice: "Notice", PressTarget: "PressTarget", Row: "Row", Screen: "Screen", Section: "Section",
  radii: {}, tap: () => undefined, useColors: () => ({}), useToast: () => m.toast,
}));
vi.mock("@/components/child-filter", () => ({ ChildFilter: "ChildFilter" }));
vi.mock("@/components/date-field", () => ({ DateField: "DateField" }));
vi.mock("@/components/disclosure", () => ({ Disclosure: ({ children, title }: { children: React.ReactNode; title: string }) => React.createElement("Disclosure", { title }, children) }));
vi.mock("@/components/medical-source", () => ({ MedicalSource: "MedicalSource" }));
vi.mock("@/components/care-glance", () => ({ useMinuteClock: () => new Date("2027-03-10T02:00:00Z") }));
import Milestones from "../app/milestones";
import { milestones } from "./milestones";

const born = { id: "kid", name: "Isla", birth_date: "2027-01-20", due_date: null } as unknown as Child;
const first = milestones.ages[0].domains[0].items[0];
let renderer: ReactTestRenderer | undefined;
const mount = () => act(async () => { renderer = create(<Milestones />); });
const words = () => JSON.stringify(renderer!.toJSON());
const row = (label: string) => renderer!.root.findAll((n) => String(n.type) === "PressTarget").find((n) => n.props.accessibilityLabel === label)!;

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); m.rows = []; m.child = born; m.logged = []; m.undone = 0; m.amended = 0; m.toast.mockClear(); m.push.mockClear(); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

const saved = (): BabyRecord => ({ id: "m1", kind: "milestone", title: first.text, body: "", child_id: "kid", occurred_at: "2027-02-20T02:00:00Z", data: { milestone_id: first.id }, revision: 1, created_at: "", updated_at: "" });

describe("the list", () => {
  it("opens at the child's age with CDC's heading, words, attribution and non-endorsement line", async () => {
    await mount();
    const text = words();
    expect(text).toContain("What most babies do by 2 months");
    expect(text).toContain(first.text);
    expect(text).toContain(milestones.attribution);
    expect(text).toContain(milestones.non_endorsement);
    expect(text).toContain(milestones.not_a_screening_tool);
    expect(text).toContain(milestones.concerned.text);
    expect(text).toContain(milestones.ages[0].url);
  });
  it("never scores: no count, percentage, progress or 'behind', with or without checked milestones", async () => {
    m.rows = [saved()];
    await mount();
    const shown = renderer!.root.findAll((n) => ["Copy", "Row", "Screen", "Empty"].includes(String(n.type))).map((n) => [n.props.title, n.props.detail, n.props.body, n.props.subtitle, ...[n.props.children].flat()].filter((v) => typeof v === "string").join(" ")).join("\n");
    expect(shown).not.toMatch(/\d+\s*(of|\/)\s*\d+|\d\s*%|percent|score|progress|behind|delayed|overdue|on track/i);
  });
  it("shows nothing to check before birth", async () => {
    m.child = { id: "kid", name: "Isla", birth_date: null, due_date: "2027-06-01" };
    await mount();
    expect(words()).not.toContain(first.text);
    expect(renderer!.root.findAll((n) => String(n.type) === "Empty")[0].props.title).toBe("Milestones start after birth");
  });
});

describe("checking one off", () => {
  it("saves a milestone record with its id, CDC's words and today's date, with Undo", async () => {
    await mount();
    await act(async () => row(first.text).props.onPress());
    expect(m.logged[0].record).toMatchObject({ kind: "milestone", title: first.text, child_id: "kid", data: { milestone_id: first.id } });
    const [message, action] = m.toast.mock.calls[0];
    expect(message).toBe("Saved with today’s date.");
    await act(async () => action.onPress());
    expect(m.undone).toBe(1);
  });
  it("reads as checked to VoiceOver with its date, and tapping shows the date to change or take back", async () => {
    m.rows = [saved()];
    await mount();
    const target = row(first.text);
    expect(target.props.accessibilityRole).toBe("checkbox");
    expect(target.props.accessibilityState).toEqual({ checked: true });
    expect(target.props.accessibilityValue.text).toContain("2027");
    await act(async () => target.props.onPress());
    expect(m.logged).toHaveLength(0);
    const field = renderer!.root.findAll((n) => String(n.type) === "DateField")[0];
    await act(async () => field.props.onChange("2027-02-25"));
    expect(m.amended).toBe(1);
    await act(async () => field.props.onChange("2027-01-01"));
    expect(m.amended).toBe(1);
    expect(m.toast).toHaveBeenCalled();
    await act(async () => renderer!.root.findAll((n) => String(n.type) === "Button")[0].props.onPress());
    expect(m.undone).toBe(1);
  });
  it("lists kept moments in Keepsakes with their dates, opening the record", async () => {
    m.rows = [saved()];
    await mount();
    const views = renderer!.root.findAll((n) => String(n.type) === "FilterChips")[0];
    await act(async () => views.props.onChange("kept"));
    const kept = renderer!.root.findAll((n) => String(n.type) === "Row")[0];
    expect(kept.props.title).toBe(first.text);
    expect(kept.props.detail).toContain("February 20, 2027");
    kept.props.onPress();
    expect(m.push).toHaveBeenCalledWith({ pathname: "/record/[id]", params: { id: "m1" } });
  });
});
