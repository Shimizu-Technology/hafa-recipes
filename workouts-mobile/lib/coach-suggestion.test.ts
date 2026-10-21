import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CoachAction } from "./coach";
import { initialProfile } from "./models";
import { coachRecovery, coachReturnParams } from "./coach-recovery";
import type { Workout } from "./models";

const f = vi.hoisted(() => ({ action: null as unknown, accept: vi.fn(), undo: vi.fn(), push: vi.fn(), state: "proposed", profile: null as unknown, readiness: null as unknown }));
vi.mock("@/lib/context", () => ({ useTraining: () => ({ owner: "owner", enrollment: { enrolled: true, generation: 1 }, api: {
  profileSnapshot: async () => f.profile, readiness: async () => f.readiness, coachAction: async () => f.action, profile: async () => null, coachHistory: async () => ({ messages: [], limit: 50, offset: 0 }),
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
  await act(async () => { view = create(createElement(QueryClientProvider, { client }, element)); }); await settle(); return client;
}
const card = () => mount(createElement(CoachSuggestionCard, { item: { proposal_id: "proposal", kind: "schedule", status: "ready", state: "proposed" }, generation: 1, notify }));
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f.accept.mockReset().mockResolvedValue({ proposal_id: "proposal", state: "accepted" }); f.undo.mockReset().mockResolvedValue({ proposal_id: "proposal", state: "undone" });
  f.profile = { profile: { ...initialProfile(), adult_confirmed: true, equipment: [] }, revision: 1 };
  f.readiness = { state: "unknown", expires_at: null };
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

const adultQuestion = "Confirm adult eligibility/readiness and resolve any free-text restrictions before personal adaptation.";
const equipmentQuestion = "Confirm available equipment, including any stable supports or anchors.";
const needsInfo = (questions = [adultQuestion, equipmentQuestion]): CoachAction => ({ ...proposal("move"), kind: "adaptation", target_id: "workout", proposal: { status: "needs_information", questions } });
const recovery = { focus: { context_workout_id: "workout", context_revision: 3 }, disabled: false, checkIn: vi.fn(), askAgain: vi.fn() };
const recoveryCard = () => mount(createElement(CoachSuggestionCard, { item: { proposal_id: "proposal", kind: "adaptation", status: "needs_information", state: "proposed" }, generation: 1, notify, recovery }));

it("names missing equipment and offers a profile review with the original coach context", async () => {
  f.action = needsInfo(); f.profile = { profile: { ...initialProfile(), adult_confirmed: true }, revision: 1 };
  await recoveryCard();
  expect(button("Apply")).toBeUndefined();
  expect(nodes("Copy").some(n => n.props.children === "Coach needs a little more")).toBe(true);
  expect(JSON.stringify(view!.toJSON())).not.toMatch(/Reply in the chat|Update your plan|eligibility|free-text/);
  expect(button("Not now")).toBeDefined(); expect(button("Details")).toBeDefined();
  await press("Review training profile");
  expect(f.push).toHaveBeenCalledWith({ pathname: "/profile", params: { return_to: "coach", workout_id: "workout", revision: "3" } });
});

it("offers today's check-in when profile fields are complete", async () => {
  f.action = needsInfo(); recovery.checkIn.mockClear(); await recoveryCard();
  expect(button("Review training profile")).toBeUndefined(); await press("Check in for today");
  expect(recovery.checkIn).toHaveBeenCalledOnce(); expect(f.accept).not.toHaveBeenCalled();
});

it("offers Ask again after the saved profile and daily check-in are ready", async () => {
  f.action = needsInfo(); f.readiness = { state: "ready", expires_at: "2999-01-01T00:00:00Z" };
  recovery.askAgain.mockClear(); await recoveryCard(); await press("Ask again");
  expect(recovery.askAgain).toHaveBeenCalledOnce(); expect(button("Apply")).toBeUndefined();
});

it("keeps saved limitations visible and does not claim chat can clear them", async () => {
  f.action = needsInfo(); f.profile = { profile: { ...initialProfile(), adult_confirmed: true, equipment: [], limitations: ["Follow professional instructions"] }, revision: 2 };
  f.readiness = { state: "ready", expires_at: "2999-01-01T00:00:00Z" }; await recoveryCard();
  expect(button("Review training profile")).toBeDefined(); expect(button("Ask again")).toBeUndefined();
  expect(JSON.stringify(view!.toJSON())).toContain("Keep any instructions you still follow");
});

it("does not treat a saved profile readiness choice or expired daily check-in as today's check-in", () => {
  const profile = { ...initialProfile(), adult_confirmed: true, equipment: [], readiness: "ready" as const };
  for (const checkIn of [{ state: "unknown", expires_at: null }, { state: "ready", expires_at: "2000-01-01T00:00:00Z" }, { state: "limited", expires_at: "2999-01-01T00:00:00Z" }]) {
    expect(coachRecovery(needsInfo(), profile, 2, checkIn).next).toBe("check-in");
  }
});

it("explains source timing separately from missing profile information", async () => {
  f.action = needsInfo(["Review block durations and optional work before shortening this workout; an estimate alone cannot preserve its purpose."]);
  f.readiness = { state: "ready", expires_at: "2999-01-01T00:00:00Z" }; await recoveryCard();
  expect(JSON.stringify(view!.toJSON())).toContain("Review this workout’s timing");
  await press("Review details"); expect(f.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/coach-action/[id]" }));
});

it("advances the same card from profile review to check-in to Ask again as saves update the cache", async () => {
  f.action = needsInfo(); f.profile = { profile: { ...initialProfile(), adult_confirmed: true }, revision: 1 };
  const client = await recoveryCard(); expect(button("Review training profile")).toBeDefined();
  await act(async () => { client.setQueryData(["owner", "profile", 1, "snapshot"], { profile: { ...initialProfile(), adult_confirmed: true, equipment: [] }, revision: 2 }); }); await settle();
  expect(button("Review training profile")).toBeUndefined(); expect(button("Check in for today")).toBeDefined();
  await act(async () => { client.setQueryData(["owner", "readiness", 1], { state: "ready", expires_at: "2999-01-01T00:00:00Z" }); }); await settle();
  expect(button("Check in for today")).toBeUndefined(); expect(button("Ask again")).toBeDefined();
});

it("preserves program and session context when returning from profile review", () => {
  expect(coachReturnParams({ context_program_id: "plan", context_revision: 7 })).toEqual({ program_id: "plan", revision: "7" });
  expect(coachReturnParams({ context_session_id: "session" })).toEqual({ session_id: "session" });
});
it("keeps an unrecognized movement gate until a profile edit has been saved", () => {
  const action = needsInfo(["Select recognized movement exclusions before adapting this workout."]);
  const profile = { ...initialProfile(), adult_confirmed: true, equipment: [] };
  const checkIn = { state: "ready", expires_at: "2999-01-01T00:00:00Z" };
  expect(coachRecovery(action, profile, 1, checkIn).next).toBe("profile");
  expect(coachRecovery(action, profile, 2, checkIn).next).toBe("ask"); // Server rechecks the edited movements.
});
