import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CoachAction } from "./coach";
import type { Workout } from "./models";

const f = vi.hoisted(() => ({ action: null as unknown, accept: vi.fn(), undo: vi.fn(), push: vi.fn(), state: "proposed" }));
vi.mock("@/lib/context", () => ({ useTraining: () => ({ owner: "owner", enrollment: { enrolled: true, generation: 1 }, api: {
  coachAction: async () => f.action, profile: async () => null, coachHistory: async () => ({ messages: [], limit: 50, offset: 0 }),
  program: async () => ({ sessions: [{ id: "s1", date: "2026-11-02", purpose: "Strength", workout: legs }] }), workout: async () => legs,
  acceptCoachAction: f.accept, undoCoachAction: f.undo } }) }));
vi.mock("expo-router", () => ({ router: { push: f.push, back: vi.fn(), canGoBack: () => true }, useLocalSearchParams: () => ({ id: "proposal", generation: "1", state: f.state }) }));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("@/components/ui", () => ({ ...Object.fromEntries(["Button", "Card", "Copy", "Field", "ListGroup", "ListRow", "Notice", "Row", "SkeletonCard"].map(name => [name, name])),
  Screen: (props: { children?: React.ReactNode; footer?: React.ReactNode }) => createElement("Screen", props, props.children, createElement("Footer", null, props.footer)) }));
vi.mock("@/components/coach-action-preview", () => ({ CoachActionPreview: "CoachActionPreview" }));
import { CoachSuggestionCard } from "../components/coach-suggestion";
import CoachActionReview from "../app/coach-action/[id]";

const legs = { id: "w", revision: 1, generation: 1, title: "Legs", kind: "session", provenance: "user",
  blocks: [{ id: "b", label: "Main", grouping: "sequential", exercises: [{ name: "Goblet squat", sets: 3, reps_min: 10 }] }] } as Workout;
const proposal = (operation: string, date = "2026-11-05"): CoachAction => ({ id: "proposal", kind: "schedule", profile_revision: 1, target_id: "program", target_revision: 1,
  expires_at: "2999-01-01T00:00:00Z", proposal: { status: "ready", operation, session_ids: ["s1"], confirmation_required: operation === "return",
    program: { title: "Plan", proposal: { sessions: [{ id: "s1", date, purpose: "Strength", workout: legs }] } as never } } });
let view: ReactTestRenderer | undefined;
const notify = vi.fn();
const nodes = (type: string) => view!.root.findAll(node => String(node.type) === type);
const button = (title: string) => nodes("Button").find(node => node.props.title === title);
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)); }); };
const press = async (title: string) => { await act(async () => { button(title)!.props.onPress(); }); await settle(); };
async function mount(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { view = create(createElement(QueryClientProvider, { client }, element)); }); await settle();
}
const card = () => mount(createElement(CoachSuggestionCard, { item: { proposal_id: "proposal", kind: "schedule", status: "ready", state: "proposed" }, generation: 1, notify }));
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f.accept.mockReset().mockResolvedValue({ proposal_id: "proposal", state: "accepted" }); f.undo.mockReset().mockResolvedValue({ proposal_id: "proposal", state: "undone" });
  f.push.mockReset(); notify.mockReset(); f.state = "proposed"; f.action = proposal("move");
});
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = undefined; });

it("shows what changes, applies in one tap without the return confirmation, and offers Undo", async () => {
  await card();
  expect(nodes("Copy").some(node => String(node.props.children).includes("→"))).toBe(true);
  await press("Apply");
  expect(f.accept).toHaveBeenCalledWith("proposal", "Plan", false, 1);
  expect(notify).toHaveBeenCalledWith("Change applied", expect.any(Function));
  expect(button("Apply")).toBeUndefined();
  await act(async () => notify.mock.calls[0][1]()); await settle();
  expect(f.undo).toHaveBeenCalledWith("proposal", 1); expect(notify).toHaveBeenLastCalledWith("Change undone");
});

it("hides a suggestion for now without applying it", async () => {
  await card(); await press("Not now");
  expect(button("Apply")).toBeUndefined(); expect(f.accept).not.toHaveBeenCalled();
  await press("Show"); expect(button("Apply")).toBeDefined();
});

it("sends a resume from a pause to the full review instead of applying it from the chat", async () => {
  f.action = proposal("return"); await card();
  expect(button("Apply")).toBeUndefined(); await press("Review and apply");
  expect(f.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/coach-action/[id]" })); expect(f.accept).not.toHaveBeenCalled();
});

it("confirms a resume only from the review screen that shows its sets and reps", async () => {
  f.action = proposal("return"); await mount(createElement(CoachActionReview));
  expect(nodes("CoachActionPreview")).toHaveLength(1);
  expect(nodes("Copy").some(node => String(node.props.children).includes("Goblet squat: 3 sets · 10 reps"))).toBe(true);
  await press("Apply");
  expect(f.accept).toHaveBeenCalledWith("proposal", "Plan", true, 1);
  expect(button("Undo")).toBeDefined();
});

it("does not offer Apply for an expired suggestion", async () => {
  f.action = { ...proposal("move"), expires_at: "2000-01-01T00:00:00Z" }; await card();
  expect(button("Apply")).toBeUndefined(); expect(nodes("Copy").some(node => node.props.children === "Expired")).toBe(true);
});
it("explains a readiness refusal in plain words and keeps Apply available to retry", async () => {
  f.accept.mockRejectedValueOnce(Error("Confirm readiness before applying a training change")); await card(); await press("Apply");
  expect(nodes("Notice").map(node => node.props.children)).toContain("Check in for today in Coach first, then apply.");
  expect(button("Apply")).toBeDefined(); expect(notify).not.toHaveBeenCalled();
});
it("labels a suggestion from an earlier setup instead of loading forever", async () => {
  await mount(createElement(CoachSuggestionCard, { item: { proposal_id: "proposal", kind: "schedule", status: "ready", state: "proposed" }, generation: 0, notify }));
  expect(nodes("Copy").some(node => String(node.props.children).includes("earlier Workouts setup"))).toBe(true);
  expect(nodes("Copy").some(node => String(node.props.children).includes("Loading"))).toBe(false); expect(button("Apply")).toBeUndefined();
});
