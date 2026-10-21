import { createElement, type PropsWithChildren } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  propose: vi.fn(),
  setReadiness: vi.fn(async () => undefined),
  source: { data: { id: "w1", title: "Split", revision: 4, generation: 1, kind: "session", provenance: "source",
    blocks: [{ id: "upper", label: "Upper", grouping: "sequential", exercises: [{ name: "Press" }] }] }, isPending: false, error: null },
  profile: { data: { revision: 2, profile: { primary_goal: "general_fitness", session_minutes: 45, equipment: [], timezone: "Pacific/Guam" } }, isPending: false, error: null },
}));
vi.mock("expo-router", () => ({ router: { push: vi.fn(), replace: vi.fn() }, useLocalSearchParams: () => ({ workout_id: "w1" }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => (queryKey[1] === "profile" ? fixture.profile : fixture.source),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/context", () => ({
  useTraining: () => ({ owner: "owner", enrollment: { enrolled: true, generation: 1 },
    localDrafts: { load: async () => null, save: async () => undefined, remove: async () => undefined },
    api: { proposeSourceProgram: fixture.propose, setReadiness: fixture.setReadiness } }),
}));
vi.mock("@/lib/training", () => ({ dateInTimezone: () => "2026-10-21" }));
vi.mock("@/components/query-state", () => ({ QueryState: ({ children }: PropsWithChildren) => createElement("QueryState", null, children) }));
vi.mock("@/components/program-preview", () => ({ ProgramPreview: "ProgramPreview", PrescriptionPreview: "PrescriptionPreview" }));
vi.mock("@/components/calendar-date", () => ({ CalendarDate: "CalendarDate" }));
vi.mock("@/components/readiness-picker", () => ({ ReadinessPicker: "ReadinessPicker" }));
vi.mock("@/components/ui", () => ({
  Screen: ({ children }: PropsWithChildren) => createElement("Screen", null, children),
  Button: "Button", Card: "Card", Choice: "Choice", Copy: "Copy", Field: "Field", ListGroup: "ListGroup", ListRow: "ListRow", Notice: "Notice",
}));
import ReviewPlan from "../app/review-plan";

let renderer: ReactTestRenderer | undefined;
const all = (type: string) => renderer!.root.findAll((node) => String(node.type) === type);
const press = (type: string, key: "title" | "label", value: string) => act(async () => all(type).find((node) => node.props[key] === value)!.props.onPress());
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.propose.mockReset().mockResolvedValue({ id: "r1", generation: 1, proposal: { status: "ready", sessions: [] } });
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });

it("schedules sessions by date and sends the day offsets the API expects", async () => {
  await act(async () => { renderer = create(createElement(ReviewPlan)); });
  expect(all("Field").some((node) => String(node.props.label).includes("Days after"))).toBe(false);
  await press("Button", "title", "Add a session");
  await press("Button", "title", "Add a session");
  const dates = () => all("CalendarDate").filter((node) => String(node.props.label).startsWith("Date for"));
  // New sessions land on consecutive days from the start date.
  expect(dates().map((node) => node.props.value)).toEqual(["2026-10-21", "2026-10-22"]);
  expect(dates().map((node) => node.props.label)).toEqual(["Date for Session 1", "Date for Session 2"]);
  await act(async () => dates()[1].props.onChange("2026-10-24"));
  for (const card of all("Card")) {
    await act(async () => card.findAll((node) => String(node.type) === "Choice").find((node) => node.props.label === "Upper")!.props.onPress());
    await act(async () => card.findAll((node) => String(node.type) === "Field").find((node) => node.props.label === "Session length · minutes")!.props.onChange("40"));
  }
  await press("Button", "title", "Propose my plan");
  const days = fixture.propose.mock.lastCall![4];
  expect(days).toEqual([
    { label: "Session 1", block_ids: ["upper"], day_offset: 0, duration_minutes: 40 },
    { label: "Session 2", block_ids: ["upper"], day_offset: 3, duration_minutes: 40 },
  ]);
  expect(fixture.propose.mock.lastCall![3]).toBe("2026-10-21");
});

it("stops a session dated before the start", async () => {
  await act(async () => { renderer = create(createElement(ReviewPlan)); });
  await press("Button", "title", "Add a session");
  await act(async () => all("CalendarDate").find((node) => node.props.label === "Date for Session 1")!.props.onChange("2026-10-20"));
  await press("Button", "title", "Propose my plan");
  expect(fixture.propose).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer!.toJSON())).toContain("before the start date");
});
