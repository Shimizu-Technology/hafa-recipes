import WorkoutDetail from "../app/workout/[id]";
import { createElement, type ComponentType, type PropsWithChildren, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import type { DiscoverDetail, DiscoverPage } from "./discover";
import { emptyOrganization } from "./organization";
import type { Workout } from "./models";

const fixture = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  capabilities: vi.fn(),
  discover: vi.fn(),
  discoverWorkout: vi.fn(),
  saveDiscovered: vi.fn(),
  blockDiscoverContributor: vi.fn(),
  workout: vi.fn(),
  deleteWorkout: vi.fn(),
  importJob: vi.fn(),
  importJobs: vi.fn(),
  searchLibrary: vi.fn(), collections: vi.fn(), organization: vi.fn(), saveOrganization: vi.fn(),
  importSource: vi.fn(),
  acceptImport: vi.fn(),
  cancelImport: vi.fn(),
  publishingDisclosure: vi.fn(),
  acceptPublishingDisclosure: vi.fn(),
  agree: true,
  asked: 0,
  push: vi.fn(),
  replace: vi.fn(),
  toast: vi.fn(),
  map: new Map<string, string>(),
  focus: false,
  appState: "active",
  appStateListeners: new Set<(state: string) => void>(),
  current: true, generation: 1,
  load: vi.fn(),
  saveDraft: vi.fn(),
}));
vi.mock("@/lib/context", () => {
  const storage = {
    isCurrent: () => true,
    removeItem: async (key: string) => void fixture.map.delete(key),
    getItem: async (key: string) => fixture.map.get(key) ?? null,
    setItem: async (key: string, value: string) => void fixture.map.set(key, value),
  };
  const localDrafts = { load: fixture.load, save: fixture.saveDraft, remove: async () => undefined };
  const api = {
    capabilities: fixture.capabilities,
    discover: fixture.discover,
    discoverWorkout: fixture.discoverWorkout,
    saveDiscovered: fixture.saveDiscovered,
    blockDiscoverContributor: fixture.blockDiscoverContributor,
    workout: fixture.workout,
    deleteWorkout: fixture.deleteWorkout,
    importJob: fixture.importJob,
    importJobs: fixture.importJobs,
    searchLibrary: fixture.searchLibrary, collections: fixture.collections, organization: fixture.organization, saveOrganization: fixture.saveOrganization,
    importSource: fixture.importSource,
    acceptImport: fixture.acceptImport,
    cancelImport: fixture.cancelImport,
    publishingDisclosure: fixture.publishingDisclosure,
    acceptPublishingDisclosure: fixture.acceptPublishingDisclosure,
  };
  return {
    useOfflineTraining: () => ({ ready: true, state: { active: null, history: [] }, store: { start: vi.fn(), snapshot: () => ({ active: null, history: [] }) } }),
    useTraining: () => ({
      api,
      owner: "owner",
      enrollment: { enrolled: true, generation: fixture.generation },
      storage,
      localDrafts,
      isCurrentAccount: () => fixture.current,
    }),
  };
});
vi.mock("@/components/publishing-disclosure", async () => {
  const { withPublishingDisclosure } = await import("./discover");
  return {
    usePublishingDisclosure: () => ({
      run: (attempt: () => Promise<unknown>) =>
        withPublishingDisclosure(attempt, {
          status: fixture.publishingDisclosure,
          accept: fixture.acceptPublishingDisclosure,
          ask: async () => {
            fixture.asked++;
            return fixture.agree;
          },
        }),
      sheet: null,
      dismiss() {},
    }),
  };
});
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  View: "View",
  Image: "Image",
  AppState: { get currentState() { return fixture.appState; }, addEventListener: (_event: string, listener: (state: string) => void) => {
    fixture.appStateListeners.add(listener); return { remove() { fixture.appStateListeners.delete(listener); } };
  } },
  Linking: { openURL: vi.fn(async () => undefined) },
}));
vi.mock("expo-router", async () => {
  const { useEffect } = await import("react");
  return ({
  router: { push: fixture.push, replace: fixture.replace, back: vi.fn(), navigate: vi.fn() },
  useFocusEffect(callback: () => (() => void) | void) { useEffect(() => fixture.focus ? callback() : undefined, [callback, fixture.focus]); },
  useLocalSearchParams: () => fixture.params,
}); });
vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
vi.mock("@/components/ui", () => {
  const names = ["AccountButton", "Button", "Card", "Chip", "ChipRow", "Choice", "Copy", "Empty", "Field", "IconButton",
    "ListGroup", "ListRow", "MediaCard", "Notice", "Row", "Screen", "SectionHeader", "Sheet", "Skeleton", "SkeletonCard", "Stack", "StatTile"];
  return { ...Object.fromEntries(names.map((name) => [name, name])),
    Screen: ({ children, footer, ...props }: PropsWithChildren<{ footer?: ReactNode; [key: string]: unknown }>) => createElement("Screen", props, children, footer),
    useToast: () => fixture.toast };
});
vi.mock("@/components/discover-card", () => ({
  DiscoverCardView: "DiscoverCardView",
  DiscoverCardSkeleton: "DiscoverCardSkeleton",
  SourceArtwork: "SourceArtwork",
  CreditLine: "CreditLine",
}));
vi.mock("@/components/query-state", () => ({ QueryState: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/workout-editor", () => ({ WorkoutEditor: "WorkoutEditor" }));
vi.mock("@/components/source-image", () => ({ SourceImage: "SourceImage" }));
vi.mock("@/lib/capture-io", () => ({ cleanupCaptureFiles: vi.fn() }));
import Discover from "../app/(tabs)/discover";
import DiscoverWorkout from "../app/discover/[id]";
import ImportReview from "../app/import/[id]";
import Library from "../app/(tabs)/library";
import { ImportList } from "../components/import-list";
import { PrescriptionPreview } from "../components/program-preview";
import { SharedSnapshot } from "../components/shared-snapshot";
import type { ShareSnapshot } from "./sharing";

let renderer: ReactTestRenderer | undefined, cache: QueryClient;
const nodes = (type: string) => renderer!.root.findAll((n) => String(n.type) === type);
const button = (title: string) => nodes("Button").find((n) => n.props.title === title);
it("a saved workout enters planning with that workout selected", async () => {
  fixture.params = { id: "saved-1" };
  fixture.workout.mockResolvedValue({ id: "saved-1", revision: 1, generation: 1, title: "Saved session",
    kind: "session", provenance: "user", blocks: [], equipment_required: [] });
  await mount(WorkoutDetail);
  const action = nodes("ListRow").find((n) => n.props.title === "Add to a plan");
  expect(action).toBeDefined();
  await act(async () => action!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/build-plan", params: { include: "saved-1" } });
});
const choice = (label: string) => nodes("Choice").find((n) => n.props.label === label);
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((done) => setTimeout(done, 5))));
}
async function mount(component: ComponentType) {
  await act(async () => {
    renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(component)));
  });
  await settle();
}
const caps = (discover: boolean | undefined) => ({ generation: 1, imports: true, coach: true, discover, limits: {} });
const card = {
  id: "pub-1", title: "Ten minute legs", kind: "session" as const, estimated_minutes: 10,
  equipment_required: ["Dumbbell"], equipment_optional: [], block_count: 1, exercise_count: 3,
  source_url: "https://www.youtube.com/watch?v=abc", source_platform: "youtube", source_creator: "Coach Nani",
  thumbnail_url: null, published_at: "2026-10-13T02:00:00Z",
  contributor: { contributor_id: "c1", display_name: "Leon" }, is_owner: false, saved_workout_id: null,
};
const detail: DiscoverDetail = {
  ...card,
  workout: { title: card.title, kind: "session", provenance: "user", blocks: [{ id: "b", label: "Main", grouping: "circuit",
    rounds: 3, exercises: [{ name: "Goblet squat", sets: 3, reps_min: 12, reps_max: 12, rest_seconds: 45 }] }] },
};
const page = (items = [card]): DiscoverPage => ({ items, total: items.length, limit: 20, offset: 0, has_more: false });
const saved: Workout = { ...detail.workout, id: "copy-1", generation: 1, revision: 4 };

beforeEach(() => {
  fixture.map.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  for (const mock of [fixture.capabilities, fixture.discover, fixture.discoverWorkout, fixture.saveDiscovered, fixture.workout,
    fixture.importJob, fixture.importSource, fixture.acceptImport, fixture.publishingDisclosure, fixture.acceptPublishingDisclosure,
    fixture.push, fixture.replace, fixture.toast, fixture.cancelImport, fixture.deleteWorkout, fixture.blockDiscoverContributor]) mock.mockReset();
  fixture.params = {};
  fixture.focus = false;
  fixture.appState = "active"; fixture.appStateListeners.clear();
  fixture.current = true; fixture.generation = 1;
  fixture.load.mockReset().mockImplementation(async (_owner, scope) => fixture.map.has(scope) ? JSON.parse(fixture.map.get(scope)!)
    : scope.startsWith("imports:") && fixture.params.auto === "1" ? [{ id: "job", label: "Shared link", generation: 1, auto_save: true }] : null);
  fixture.saveDraft.mockReset().mockImplementation(async (_owner, scope, value) => { fixture.map.set(scope, JSON.stringify(value)); });
  fixture.agree = true;
  fixture.asked = 0;
  fixture.importSource.mockResolvedValue({ images: [], text: "" });
  fixture.importJobs.mockReset().mockResolvedValue([]);
  fixture.collections.mockReset().mockResolvedValue([]); fixture.searchLibrary.mockReset();
  fixture.organization.mockReset().mockResolvedValue(emptyOrganization()); fixture.saveOrganization.mockReset();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  cache.clear();
});

it("shows the calm unavailable state and never requests the feed when capabilities.discover is false", async () => {
  fixture.capabilities.mockResolvedValue(caps(false));
  await mount(Discover);
  expect(nodes("Empty")[0].props.title).toBe("Discover is getting ready");
  expect(nodes("Notice")).toHaveLength(0);
  expect(fixture.discover).not.toHaveBeenCalled();
});

it("treats an older server without the discover flag as unavailable", async () => {
  fixture.capabilities.mockResolvedValue(caps(undefined));
  await mount(Discover);
  expect(nodes("Empty")[0].props.title).toBe("Discover is getting ready");
  expect(fixture.discover).not.toHaveBeenCalled();
});

it("turns a 503 from the feed into the unavailable state instead of an error", async () => {
  fixture.capabilities.mockResolvedValue(caps(true));
  fixture.discover.mockRejectedValue(new ApiError("The training service or record is unavailable.", 503));
  await mount(Discover);
  expect(nodes("Empty")[0].props.title).toBe("Discover is getting ready");
  expect(nodes("Notice")).toHaveLength(0);
});

it("renders feed cards, passes an abort signal, and debounces search before refetching", async () => {
  fixture.capabilities.mockResolvedValue(caps(true));
  fixture.discover.mockResolvedValue(page());
  await mount(Discover);
  expect(nodes("DiscoverCardView").map((n) => n.props.card.id)).toEqual(["pub-1"]);
  expect(fixture.discover).toHaveBeenCalledTimes(1);
  expect(fixture.discover.mock.calls[0][1]).toBe(0);
  expect(fixture.discover.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
  await act(async () => nodes("Field")[0].props.onChange("leg"));
  await act(async () => nodes("Field")[0].props.onChange("legs"));
  expect(fixture.discover).toHaveBeenCalledTimes(1);
  await act(async () => void (await new Promise((done) => setTimeout(done, 350))));
  await settle();
  expect(fixture.discover).toHaveBeenCalledTimes(2);
  expect(fixture.discover.mock.calls[1][0]).toMatchObject({ q: "legs" });
});

it("shows a narrowed empty state with a way to clear filters", async () => {
  fixture.capabilities.mockResolvedValue(caps(true));
  fixture.discover.mockResolvedValue(page([]));
  await mount(Discover);
  expect(nodes("Empty")[0].props.title).toBe("Be the first to share");
  await act(async () => nodes("Chip").find((n) => n.props.label === "No equipment")!.props.onPress());
  await settle();
  expect(fixture.discover.mock.calls.at(-1)![0]).toMatchObject({ equipment: "none" });
  expect(nodes("Empty")[0].props.title).toBe("No workouts match");
});

it("saves from detail, then offers the saved workout and a plan", async () => {
  fixture.params = { id: "pub-1" };
  fixture.discoverWorkout.mockResolvedValue(detail);
  fixture.saveDiscovered.mockResolvedValue(saved);
  await mount(DiscoverWorkout);
  await act(async () => button("Save to my library")!.props.onPress());
  await settle();
  expect(fixture.saveDiscovered).toHaveBeenCalledWith("pub-1", 1);
  expect(fixture.toast).toHaveBeenCalledWith("Saved to your library");
  expect(nodes("Sheet").find((n) => n.props.title === "Saved to your library")!.props.visible).toBe(true);
  await act(async () => button("Add to a plan")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/build-plan", params: { include: "copy-1" } });
  expect(button("Open in your library")).toBeDefined();
});

it("asks the coach about a Discover workout by saving a private copy first", async () => {
  fixture.params = { id: "pub-1" };
  fixture.discoverWorkout.mockResolvedValue(detail);
  fixture.saveDiscovered.mockResolvedValue(saved);
  await mount(DiscoverWorkout);
  await act(async () => nodes("ListRow").find((n) => n.props.title === "Ask the coach about this")!.props.onPress());
  await settle();
  expect(fixture.saveDiscovered).toHaveBeenCalledTimes(1);
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/coach", params: { workout_id: "copy-1", revision: "4" } });
});

it("refreshes the Workouts Safety Center after blocking from Discover", async () => {
  fixture.params = { id: "pub-1" };
  fixture.discoverWorkout.mockResolvedValue(detail);
  fixture.blockDiscoverContributor.mockResolvedValue({ contributor_id: "c1", display_name: "Leon" });
  cache.setQueryData(["owner", "blocked-contributors", 1], []);
  cache.setQueryData(["other", "blocked-contributors", 1], []);
  await mount(DiscoverWorkout);
  const explanation = nodes("Copy").flatMap((node) => [node.props.children].flat()).filter((value) => typeof value === "string").join(" ");
  expect(explanation).toContain("Settings → Safety Center in either app");
  expect(explanation).not.toContain("later in Håfa Recipes under Safety Center");
  await act(async () => button("Block")!.props.onPress());
  await settle();
  expect(fixture.blockDiscoverContributor).toHaveBeenCalledExactlyOnceWith("pub-1");
  expect(cache.getQueryState(["owner", "blocked-contributors", 1])?.isInvalidated).toBe(true);
  expect(cache.getQueryState(["other", "blocked-contributors", 1])?.isInvalidated).toBe(false);
  expect(fixture.toast).toHaveBeenCalledWith("Blocked Leon");
});

it("shows owners their own workout with unpublish and no save, report or block", async () => {
  fixture.params = { id: "pub-1" };
  fixture.discoverWorkout.mockResolvedValue({ ...detail, is_owner: true });
  await mount(DiscoverWorkout);
  expect(button("Save to my library")).toBeUndefined();
  expect(button("Remove from Discover")).toBeDefined();
  expect(nodes("IconButton").find((n) => n.props.label === "More options")).toBeUndefined();
});

it("shows the unavailable state on a detail 503", async () => {
  fixture.params = { id: "pub-1" };
  fixture.discoverWorkout.mockRejectedValue(new ApiError("unavailable", 503));
  await mount(DiscoverWorkout);
  expect(nodes("Empty")[0].props.title).toBe("Discover is getting ready");
});

function importJob(captureKind: Workout["capture_kind"], status: "ready" | "incomplete" = "ready") {
  return {
    id: "job", generation: 1, status, attempt_count: 1, expires_at: "2026-10-20T00:00:00Z", accepted_workout_id: null,
    result: {
      status, evidence: [], warnings: [],
      workout: { ...detail.workout, capture_kind: captureKind },
      source: { platform: captureKind === "url" ? "youtube" : "images", channels: [], coverage_notes: [] },
    },
  };
}
async function reviewAndSave(title: string) {
  await act(async () => button(title)!.props.onPress());
  await settle();
}

it("defaults Share to Discover on for link imports and publishes on accept", async () => {
  fixture.params = { id: "job" };
  fixture.capabilities.mockResolvedValue(caps(true));
  fixture.importJob.mockResolvedValue(importJob("url"));
  fixture.acceptImport.mockResolvedValue(saved);
  await mount(ImportReview);
  expect(choice("Share to Discover")!.props.selected).toBe(true);
  await reviewAndSave("Save and share to Discover");
  expect(fixture.acceptImport).toHaveBeenCalledWith("job", expect.objectContaining({ title: card.title }), 1, true, true);
});
it("refreshes a warm empty inbox and saved library after sharing while the focused app is backgrounded", async () => {
  fixture.focus = true; fixture.capabilities.mockResolvedValue({ ...caps(false), server_auto_save: true });
  fixture.searchLibrary.mockResolvedValue({ items: [], total: 0, has_more: false });
  await mount(Library);
  expect(fixture.importJobs).toHaveBeenCalledTimes(1); expect(nodes("MediaCard")).toHaveLength(0);
  const change = async (state: string) => {
    fixture.appState = state;
    await act(async () => { for (const listener of [...fixture.appStateListeners]) listener(state); });
    await settle();
  };
  await change("background");
  const job = { ...importJob("url"), status: "processing", result: null };
  fixture.importJobs.mockResolvedValue([job]); fixture.importJob.mockResolvedValue(job);
  fixture.map.set("imports:1", JSON.stringify([{ id: "job", label: "Shared source" }]));
  await change("active");
  expect(fixture.importJobs).toHaveBeenCalledTimes(2); expect(button("View progress")).toBeDefined();
  expect(fixture.load.mock.calls.filter(([, key]) => key === "imports:1")).toHaveLength(2);
  await change("background");
  fixture.importJobs.mockResolvedValue([{ ...importJob("url"), accepted_workout_id: saved.id }]);
  fixture.searchLibrary.mockResolvedValue({ items: [saved], total: 1, has_more: false });
  await change("active");
  expect(fixture.importJobs).toHaveBeenCalledTimes(3);
  expect(fixture.searchLibrary).toHaveBeenCalledTimes(2); expect(nodes("MediaCard")).toHaveLength(1);
  expect(button("View progress")).toBeUndefined();
});
it("reloads device imports on foreground only for the current account on legacy servers", async () => {
  fixture.focus = true; fixture.capabilities.mockResolvedValue(caps(false));
  fixture.importJob.mockResolvedValue({ ...importJob("url"), status: "processing", result: null });
  await mount(ImportList);
  const change = async (state: string) => {
    fixture.appState = state;
    await act(async () => { for (const listener of [...fixture.appStateListeners]) listener(state); });
    await settle();
  };
  await change("background");
  fixture.map.set("imports:1", JSON.stringify([{ id: "job", label: "Device source" }]));
  fixture.current = false; await change("active");
  expect(button("View progress")).toBeUndefined();
  fixture.current = true; await change("background"); await change("active");
  expect(button("View progress")).toBeDefined(); expect(fixture.importJobs).not.toHaveBeenCalled();
});
it("recovers a pending server import on a device without local references", async () => {
  fixture.focus = true; fixture.capabilities.mockResolvedValue({ ...caps(true), server_auto_save: true });
  const job = { ...importJob("url"), status: "processing", result: null };
  fixture.importJobs.mockResolvedValue([job]); fixture.importJob.mockResolvedValue(job);
  await mount(ImportList);
  expect(fixture.importJobs).toHaveBeenCalled(); expect(button("View progress")).toBeDefined();
  await act(async () => button("View progress")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/import/[id]", params: { id: "job" } });
  expect(fixture.acceptImport).not.toHaveBeenCalled();
});
it("shows a recoverable server inbox error while keeping device imports", async () => {
  fixture.focus = true; fixture.capabilities.mockResolvedValue({ ...caps(true), server_auto_save: true });
  fixture.map.set("imports:1", JSON.stringify([{ id: "job", label: "Saved source" }]));
  fixture.importJobs.mockRejectedValue(Error("network offline")); fixture.importJob.mockResolvedValue({ ...importJob("url"), status: "processing", result: null });
  await mount(ImportList);
  expect(button("Retry imports")).toBeDefined(); expect(button("View progress")).toBeDefined();
});
it("dismisses a failed server import durably while retaining unrelated imports and saved workouts", async () => {
  fixture.focus = true; fixture.capabilities.mockResolvedValue({ ...caps(true), server_auto_save: true });
  const failed = { ...importJob("url"), status: "failed", accepted_workout_id: null };
  fixture.map.set("imports:1", JSON.stringify([{ id: "job", label: "Failed source" }, { id: "other", label: "Other source" }]));
  fixture.importJobs.mockResolvedValue([failed]);
  fixture.importJob.mockImplementation(async id => id === "job" ? failed : { ...failed, id, status: "processing" });
  fixture.cancelImport.mockResolvedValue(undefined);
  cache.setQueryData(["owner", "workout", "saved", 1], saved);
  await mount(ImportList);
  expect(button("Retry or add caption")).toBeDefined();
  await act(async () => button("Dismiss import")!.props.onPress()); await settle();
  expect(fixture.cancelImport).toHaveBeenCalledWith("job", 1);
  expect(JSON.parse(fixture.map.get("imports:1")!).map((item: { id: string }) => item.id)).toEqual(["other"]);
  expect(cache.getQueryData(["owner", "workout", "saved", 1])).toEqual(saved);
  expect(button("Dismiss import")).toBeUndefined();
});
it("clears legacy cancelled references even when the server inbox excludes them", async () => {
  fixture.focus = true; fixture.capabilities.mockResolvedValue({ ...caps(true), server_auto_save: true });
  fixture.map.set("imports:1", JSON.stringify([{ id: "job", label: "Cancelled source" }]));
  fixture.importJobs.mockResolvedValue([]); fixture.importJob.mockResolvedValue({ ...importJob("url"), status: "cancelled" });
  await mount(ImportList); await settle();
  expect(JSON.parse(fixture.map.get("imports:1")!)).toEqual([]);
  expect(fixture.cancelImport).not.toHaveBeenCalled();
  expect(button("Dismiss import")).toBeUndefined();
});
it("keeps a failed import recoverable when dismissal cannot reach the server", async () => {
  fixture.focus = true; fixture.capabilities.mockResolvedValue(caps(false));
  fixture.map.set("imports:1", JSON.stringify([{ id: "job", label: "Failed source" }]));
  fixture.importJob.mockResolvedValue({ ...importJob("url"), status: "failed" });
  fixture.cancelImport.mockRejectedValue(Error("Network unavailable"));
  await mount(ImportList); await act(async () => button("Dismiss import")!.props.onPress()); await settle();
  expect(JSON.parse(fixture.map.get("imports:1")!)).toHaveLength(1);
  expect(button("Retry or add caption")).toBeDefined();
});
it("a server-saved incomplete workout exposes credit, cover, timing and optional edits without another acceptance", async () => {
  fixture.focus = true; fixture.params = { id: "job" }; fixture.capabilities.mockResolvedValue({ ...caps(true), server_auto_save: true });
  const job = importJob("url", "incomplete");
  fixture.importJob.mockResolvedValue({ ...job, accepted_workout_id: "saved", result: { ...job.result, warnings: ["Load was not specified"],
    workout: { ...job.result.workout, source_title: "Six round circuit", source_creator: "Creator", source_thumbnail_url: "https://example.test/cover.jpg",
      blocks: [{ ...job.result.workout.blocks[0], rounds: 6, rest_between_rounds_seconds: 120,
        exercises: [{ name: "Squat", duration_seconds: 20, rest_seconds: 10, notes: "Keep control" }] }] } } });
  await mount(ImportReview);
  const rendered = JSON.stringify(renderer!.toJSON());
  expect(rendered).toContain("Six round circuit"); expect(rendered).toContain("Creator"); expect(rendered).toContain("2 min between rounds"); expect(rendered).toContain("Keep control");
  expect(nodes("SourceImage")[0].props.uri).toBe("https://example.test/cover.jpg");
  expect(button("Save workout")).toBeUndefined(); expect(button("Save and share to Discover")).toBeUndefined();
  expect(fixture.acceptImport).not.toHaveBeenCalled();
  await act(async () => button("Check details")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/edit-workout/[id]", params: { id: "saved" } });
});
it("Library cards retain the source cover and creator while marking unresolved source details", async () => {
  fixture.capabilities.mockResolvedValue(caps(false));
  fixture.searchLibrary.mockResolvedValue({ items: [{ ...saved, source_thumbnail_url: "https://example.test/cover.jpg",
    source_creator: "Creator", extraction_warnings: ["Rest unknown"] }], total: 1, has_more: false });
  await mount(Library);
  expect(nodes("MediaCard")[0].props).toMatchObject({ image: "https://example.test/cover.jpg", badge: "Check details" });
  expect(nodes("MediaCard")[0].props.footer.props.children).toContain("Creator");
});
it("saved detail retains source metadata and prevents starting a source-only draft with no exercises", async () => {
  fixture.params = { id: "source-only" }; fixture.capabilities.mockResolvedValue(caps(false));
  fixture.workout.mockResolvedValue({ ...saved, provenance: "source", blocks: [], source_url: "https://example.test/source", source_title: "Original clip", source_creator: "Creator",
    source_thumbnail_url: "https://example.test/cover.jpg", extraction_warnings: ["No readable instructions"] });
  await mount(WorkoutDetail);
  expect(button("Start this workout")).toBeUndefined();
  await act(async () => button("Recover workout instructions")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/recover-workout/[id]", params: { id: saved.id } });
  expect(nodes("SourceImage")[0].props.uri).toBe("https://example.test/cover.jpg");
  const text = nodes("Copy").flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
  expect(text).toContain("No readable instructions"); expect(button("Check details")).toBeDefined();
  expect(button("Recover from caption or source")).toBeUndefined();
  expect(button("Review tracking details")).toBeUndefined();
});

it("defaults Share to Discover off for photo imports and saves privately", async () => {
  fixture.params = { id: "job" };
  fixture.capabilities.mockResolvedValue(caps(true));
  fixture.importJob.mockResolvedValue(importJob("images"));
  fixture.acceptImport.mockResolvedValue(saved);
  await mount(ImportReview);
  expect(choice("Share to Discover")!.props.selected).toBe(false);
  await reviewAndSave("Save workout");
  expect(fixture.acceptImport).toHaveBeenCalledWith("job", expect.anything(), 1, false, true);
});

it("hides the toggle and saves privately when Discover is unavailable", async () => {
  fixture.params = { id: "job" };
  fixture.capabilities.mockResolvedValue(caps(false));
  fixture.importJob.mockResolvedValue(importJob("url"));
  fixture.acceptImport.mockResolvedValue(saved);
  await mount(ImportReview);
  expect(choice("Share to Discover")).toBeUndefined();
  await reviewAndSave("Save workout");
  expect(fixture.acceptImport).toHaveBeenCalledWith("job", expect.anything(), 1, false, true);
});

it("can't share an unchanged incomplete extraction", async () => {
  fixture.params = { id: "job" };
  fixture.capabilities.mockResolvedValue(caps(true));
  fixture.importJob.mockResolvedValue(importJob("url", "incomplete"));
  await mount(ImportReview);
  expect(choice("Share to Discover")!.props).toMatchObject({ selected: false, disabled: true });
  expect(button("Save workout")).toBeDefined();
});

it("on a disclosure 409 asks once, records acceptance and retries the shared accept", async () => {
  fixture.params = { id: "job" };
  fixture.capabilities.mockResolvedValue(caps(true));
  fixture.importJob.mockResolvedValue(importJob("url"));
  fixture.acceptImport
    .mockRejectedValueOnce(new ApiError("conflict", 409, false, "Accept the current publishing disclosure before sharing recipes"))
    .mockResolvedValueOnce(saved);
  fixture.publishingDisclosure.mockResolvedValue({ current_version: 1, accepted_version: 0, requires_acceptance: true });
  fixture.acceptPublishingDisclosure.mockResolvedValue({ current_version: 1, accepted_version: 1, requires_acceptance: false });
  await mount(ImportReview);
  await reviewAndSave("Save and share to Discover");
  expect(fixture.asked).toBe(1);
  expect(fixture.acceptPublishingDisclosure).toHaveBeenCalledWith(1);
  expect(fixture.acceptImport).toHaveBeenCalledTimes(2);
  expect(fixture.replace).toHaveBeenCalledWith({ pathname: "/workout/[id]", params: { id: "copy-1" } });
});

it("saves privately when the person declines the publishing disclosure", async () => {
  fixture.params = { id: "job" };
  fixture.agree = false;
  fixture.capabilities.mockResolvedValue(caps(true));
  fixture.importJob.mockResolvedValue(importJob("url"));
  fixture.acceptImport.mockResolvedValue(saved).mockRejectedValueOnce(
    new ApiError("conflict", 409, false, "Accept the current publishing disclosure before sharing recipes")
  );
  fixture.publishingDisclosure.mockResolvedValue({ current_version: 1, accepted_version: 0, requires_acceptance: true });
  await mount(ImportReview);
  await reviewAndSave("Save and share to Discover");
  expect(fixture.acceptPublishingDisclosure).not.toHaveBeenCalled();
  expect(fixture.acceptImport).toHaveBeenCalledTimes(2);
  expect(fixture.acceptImport).toHaveBeenLastCalledWith("job", expect.anything(), 1, false, true);
  expect(fixture.replace).toHaveBeenCalledWith({ pathname: "/workout/[id]", params: { id: "copy-1" } });
  expect(choice("Share to Discover")!.props.selected).toBe(false);
  expect(button("Save workout")).toBeDefined();
});

it("automatically saves a clean new extraction without accepting missing details", async () => {
  fixture.focus = true;
  fixture.params = { id: "job", auto: "1" };
  fixture.capabilities.mockResolvedValue(caps(false));
  fixture.importJob.mockResolvedValue(importJob("url"));
  fixture.acceptImport.mockResolvedValue(saved);
  await mount(ImportReview);
  expect(fixture.acceptImport).toHaveBeenCalledTimes(1);
  expect(fixture.acceptImport).toHaveBeenCalledWith("job", expect.anything(), 1, false, false);
  expect(fixture.replace).toHaveBeenCalledWith({ pathname: "/workout/[id]", params: { id: "copy-1" } });
});
it.each(["missing", "warning"])("keeps %s results for an explicit save rather than guessing", async (kind) => {
  fixture.focus = true;
  fixture.params = { id: "job", auto: "1" };
  const job = importJob("url", kind === "missing" ? "incomplete" : "ready");
  if (kind === "warning") job.result.warnings = ["Rounds unknown"] as never[];
  fixture.capabilities.mockResolvedValue(caps(false));
  fixture.importJob.mockResolvedValue(job);
  fixture.acceptImport.mockResolvedValue(saved);
  await mount(ImportReview);
  expect(fixture.acceptImport).not.toHaveBeenCalled();
  await reviewAndSave("Save workout");
  expect(fixture.acceptImport).toHaveBeenCalledWith("job", expect.anything(), 1, false, true);
});
it("an automatic save response arriving after account retirement cannot navigate or remove another account's drafts", async () => {
  fixture.focus = true;
  fixture.params = { id: "job", auto: "1" };
  fixture.capabilities.mockResolvedValue(caps(false));
  fixture.importJob.mockResolvedValue(importJob("url"));
  let finish!: (value: Workout) => void;
  fixture.acceptImport.mockImplementation(() => new Promise<Workout>((resolve) => { finish = resolve; }));
  await mount(ImportReview);
  expect(fixture.acceptImport).toHaveBeenCalledTimes(1);
  fixture.current = false;
  await act(async () => finish(saved));
  await settle();
  expect(fixture.replace).not.toHaveBeenCalled();
});

it("background saving honors a persisted private choice even after publishing disclosure is accepted elsewhere", async () => {
  fixture.focus = true;
  fixture.map.set("imports:1", JSON.stringify([{ id: "job", label: "Link", generation: 1, auto_save: true }]));
  fixture.map.set("import-visibility:1:job", "false");
  fixture.capabilities.mockResolvedValue(caps(true));
  let accepted = false;
  fixture.importJob.mockImplementation(async () => ({ ...importJob("url"), accepted_workout_id: accepted ? saved.id : null }));
  fixture.acceptImport.mockImplementation(async () => { accepted = true; return saved; });
  fixture.publishingDisclosure.mockResolvedValue({ current_version: 1, accepted_version: 1, requires_acceptance: false });
  await mount(ImportList);
  await settle();
  expect(fixture.acceptImport).toHaveBeenCalledTimes(1);
  expect(fixture.acceptImport).toHaveBeenCalledWith("job", expect.anything(), 1, false, false);
  expect(fixture.publishingDisclosure).not.toHaveBeenCalled();
  expect(JSON.parse(fixture.map.get("imports:1")!)).toEqual([]);
});
it("an auto route parameter cannot authorize saving an older import without its persisted choice", async () => {
  fixture.focus = true;
  fixture.params = { id: "job", auto: "1" };
  fixture.load.mockResolvedValue(null);
  fixture.capabilities.mockResolvedValue(caps(false));
  fixture.importJob.mockResolvedValue(importJob("url"));
  await mount(ImportReview);
  expect(fixture.acceptImport).not.toHaveBeenCalled();
});

it("informational sampled-frame metadata does not add a confirmation to a complete extraction", async () => {
  fixture.focus = true;
  fixture.params = { id: "job", auto: "1" };
  const job = importJob("url");
  job.result.source.coverage_notes = ["Frames sampled; not every frame was inspected."] as never[];
  fixture.capabilities.mockResolvedValue(caps(false));
  fixture.importJob.mockResolvedValue(job);
  fixture.acceptImport.mockResolvedValue(saved);
  await mount(ImportReview);
  expect(fixture.acceptImport).toHaveBeenCalledWith("job", expect.anything(), 1, false, false);
});

it("a failed saved-choice restore stays closed and can be retried explicitly", async () => {
  fixture.focus = true; fixture.params = { id: "job", auto: "1" };
  const healthy = fixture.load.getMockImplementation()!;
  fixture.load.mockImplementation(async (...args) => { if (args[1].startsWith("import-visibility:")) throw Error("device read failed"); return healthy(...args); });
  fixture.capabilities.mockResolvedValue(caps(false)); fixture.importJob.mockResolvedValue(importJob("url"));
  fixture.acceptImport.mockResolvedValue(saved); await mount(ImportReview);
  expect(fixture.acceptImport).not.toHaveBeenCalled();
  expect(button("Save workout")!.props.disabled).toBe(true);
  expect(button("Try loading again")).toBeDefined();
  fixture.load.mockImplementation(healthy); await act(async () => button("Try loading again")!.props.onPress()); await settle();
  expect(fixture.acceptImport).toHaveBeenCalledTimes(1);
});
it("background completion cleans its source after the user leaves while acceptance is in flight", async () => {
  const { draftKey } = await import("./drafts");
  fixture.focus = true;
  fixture.map.set("imports:1", JSON.stringify([{ id: "job", label: "Link", generation: 1, auto_save: true }]));
  fixture.map.set("import-visibility:1:job", "false");
  fixture.map.set(draftKey("owner", "capture:1"), JSON.stringify({ request_id: "request", generation: 1, job_id: "job",
    kind: "url", source_url: "https://example.test/workout", text: "", files: [], created_at: "2026-10-13T00:00:00Z" }));
  fixture.capabilities.mockResolvedValue(caps(false)); fixture.importJob.mockResolvedValue(importJob("url"));
  let finish!: (value: Workout) => void; fixture.acceptImport.mockImplementation(() => new Promise<Workout>((resolve) => { finish = resolve; }));
  await mount(ImportList); expect(fixture.acceptImport).toHaveBeenCalledTimes(1); fixture.focus = false;
  await act(async () => renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(ImportList)))); await settle();
  await act(async () => finish(saved)); await settle();
  expect(fixture.acceptImport).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fixture.map.get("imports:1")!)).toEqual([]);
  expect(fixture.map.has(draftKey("owner", "capture:1"))).toBe(false);
});
it("a cold return reconciles an already saved import without another acceptance", async () => {
  const { draftKey } = await import("./drafts");
  fixture.focus = true;
  fixture.map.set("imports:1", JSON.stringify([{ id: "job", label: "Link", generation: 1, auto_save: true }]));
  fixture.map.set(draftKey("owner", "capture:1"), JSON.stringify({ request_id: "request", generation: 1, job_id: "job",
    kind: "url", source_url: "https://example.test/workout", text: "", files: [], created_at: "2026-10-13T00:00:00Z" }));
  fixture.capabilities.mockResolvedValue(caps(false));
  fixture.importJob.mockResolvedValue({ ...importJob("url"), accepted_workout_id: saved.id });
  await mount(ImportList); await settle();
  expect(fixture.acceptImport).not.toHaveBeenCalled();
  expect(JSON.parse(fixture.map.get("imports:1")!)).toEqual([]);
  expect(fixture.map.has(draftKey("owner", "capture:1"))).toBe(false);
});

it("shows the saved timed prescription, source details and cues without missing-reps noise", async () => {
  fixture.params = { id: "saved-run" };
  fixture.capabilities.mockResolvedValue(caps(false));
  fixture.workout.mockResolvedValue({ ...saved, source_url: "https://example.test/run", blocks: [{
    id: "intervals", label: "Intervals", grouping: "interval", rounds: 3, rest_between_rounds_seconds: 60,
    exercises: [{ name: "Run", provenance: "source", sets: 2, duration_seconds: 90, distance_meters: 400,
      rest_seconds: 45, load: 5, load_unit: "kg", load_convention: "total", tempo: "Controlled", notes: "Stay comfortable" }],
  }] });
  await mount(WorkoutDetail);
  const text = nodes("Copy").flatMap((node) => node.children.filter((child) => typeof child === "string")).join(" ");
  expect(text).toContain("2 × 1m 30s · 400 m · 45s rest · Source load: 5 kg total · Tempo Controlled");
  expect(text).toContain("1 min between rounds");
  expect(text).toContain("Stay comfortable");
  expect(text).not.toContain("Reps not specified");
  expect(button("Open original source")).toBeDefined();
});


it.each(["native", "server"])("keeps an unsaved private %s receipt private after correction", async (source) => {
  fixture.params = { id: "job" }; fixture.capabilities.mockResolvedValue(caps(true));
  const job = importJob("url", "incomplete");
  fixture.importJob.mockResolvedValue({ ...job, ...(source === "server" ? { source_is_public: false } : {}) });
  if (source === "native") fixture.map.set("import-source-visibility:1:job", JSON.stringify(false));
  fixture.map.set("import-edit:1:job", JSON.stringify({ ...job.result.workout, title: "Corrected workout" }));
  fixture.acceptImport.mockResolvedValue(saved);
  await mount(ImportReview);
  expect(choice("Share to Discover")!.props).toMatchObject({ selected: false, disabled: false });
  await reviewAndSave("Save workout");
  expect(fixture.acceptImport).toHaveBeenCalledWith("job", expect.objectContaining({ title: "Corrected workout" }), 1, false, true);
});

it("keeps a deliberate later public choice ahead of the original private receipt", async () => {
  fixture.params = { id: "job" }; fixture.capabilities.mockResolvedValue(caps(true));
  fixture.importJob.mockResolvedValue({ ...importJob("url"), source_is_public: false });
  fixture.map.set("import-source-visibility:1:job", JSON.stringify(false));
  fixture.map.set("import-visibility:1:job", JSON.stringify(true));
  await mount(ImportReview);
  expect(choice("Share to Discover")!.props.selected).toBe(true);
});

it("waits for source visibility restoration before allowing a newer sharing choice", async () => {
  fixture.params = { id: "job" }; fixture.capabilities.mockResolvedValue(caps(true));
  fixture.importJob.mockResolvedValue(importJob("url"));
  let restoreSource!: (value: boolean) => void;
  const source = new Promise<boolean>((resolve) => { restoreSource = resolve; });
  const healthy = fixture.load.getMockImplementation()!;
  fixture.load.mockImplementation((...args) => args[1].startsWith("import-source-visibility:") ? source : healthy(...args));
  await mount(ImportReview);
  expect(choice("Share to Discover")!.props.disabled).toBe(true);
  await act(async () => choice("Share to Discover")!.props.onPress());
  expect(fixture.saveDraft).not.toHaveBeenCalled();
  await act(async () => restoreSource(true));
  expect(choice("Share to Discover")!.props).toMatchObject({ selected: true, disabled: false });
  await act(async () => choice("Share to Discover")!.props.onPress());
  expect(choice("Share to Discover")!.props.selected).toBe(false);
  expect(fixture.map.get("import-visibility:1:job")).toBe("false");
});


it("shows source-wide instructions and review action instead of starting a one-pass timed flow", async () => {
  fixture.params = { id: "source-flow" };
  fixture.capabilities.mockResolvedValue(caps(false));
  const quote = "Keep repeating for 20 minutes. Rest two to three minutes between flows.";
  fixture.workout.mockResolvedValue({ ...saved, provenance: "source", estimated_minutes: 20,
    instructions: [quote], notes: ["Private owner note"], blocks: [{ id: "flow", label: "Kettlebell flow", grouping: "circuit",
      exercises: [{ name: "Curls", provenance: "source", reps_min: 10, reps_max: 10 }] }] });
  await mount(WorkoutDetail);
  const text = nodes("Copy").flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
  expect(text).toContain(quote);
  expect(button("Start this workout")!.props.disabled).toBe(true);
  expect(nodes("ListRow").find(node => node.props.title === "Add to a plan")!.props.disabled).toBe(true);
  await act(async () => button("Review tracking details")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/edit-workout/[id]", params: { id: saved.id } });
});

it("keeps the original overall instructions visible during import review", async () => {
  fixture.params = { id: "job" };
  fixture.capabilities.mockResolvedValue(caps(false));
  const job = importJob("url", "incomplete");
  job.result.workout.instructions = ["20min AMRAP: repeat four moves for 20min"];
  fixture.importJob.mockResolvedValue(job);
  await mount(ImportReview);
  const text = nodes("Copy").flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
  expect(text).toContain(job.result.workout.instructions[0]);
});

it.each([1200, 125])("presents a %s-second AMRAP cap as authoritative over a separate estimate", async seconds => {
  fixture.params = { id: saved.id }; fixture.capabilities.mockResolvedValue(caps(false));
  fixture.workout.mockResolvedValue({ ...saved, estimated_minutes: 25, blocks: [{ id: "flow", label: "Flow", grouping: "circuit",
    execution: { mode: "amrap", time_cap_seconds: seconds }, exercises: [{ name: "Curls", reps_min: 10 }] }] });
  await mount(WorkoutDetail);
  expect(nodes("StatTile").find(n => n.props.label === "Estimated time")).toBeUndefined();
  const text = nodes("Copy").flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
  expect(text).toContain(seconds === 1200 ? "20 min" : "2m 5s"); expect(text).toContain("AMRAP time cap");
  expect(text).toContain("AMRAP"); expect(text).not.toContain("Rounds not specified");
});
it("gives an empty manual workout a usable add-exercises action", async () => {
  fixture.params = { id: saved.id }; fixture.capabilities.mockResolvedValue(caps(false));
  fixture.workout.mockResolvedValue({ ...saved, blocks: [] }); await mount(WorkoutDetail);
  expect(button("Start this workout")).toBeUndefined();
  await act(async () => button("Add workout exercises")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/edit-workout/[id]", params: { id: saved.id } });
});

it.each(["import", "plan", "shared workout", "shared program", "discover"] as const)(
  "%s presents typed AMRAP execution without relying on an estimate or written notes", async surface => {
    const workout: Workout = { ...saved, title: "Source circuit", estimated_minutes: null, instructions: ["Rest after each round"], notes: [], blocks: [
      { id: "flow", label: "Main", grouping: "circuit", execution: { mode: "amrap", time_cap_seconds: 1200 },
        exercises: [{ name: "Swings", reps_min: 10, instructions: "Keep your back steady" }] },
    ] };
    const snapshot: ShareSnapshot = { kind: surface === "shared program" ? "program" : "workout",
      content: surface === "shared program" ? { title: "Source plan", sessions: [{ sequence: 1, day_offset: 0, workout }], notice: "Review this plan" } : workout,
      attribution: { shared_by_display_name: "Source owner", source_revision: 1, original_source_included: false }, review_required: true };
    if (surface === "import") {
      fixture.params = { id: "job" }; fixture.capabilities.mockResolvedValue(caps(false));
      const job = importJob("images"); fixture.importJob.mockResolvedValue({ ...job, result: { ...job.result, workout } });
      await mount(ImportReview);
    } else if (surface === "plan") await mount(() => createElement(PrescriptionPreview, { workout }));
    else if (surface === "discover") {
      fixture.params = { id: "pub-1" }; fixture.discoverWorkout.mockResolvedValue({ ...detail, estimated_minutes: null, workout });
      await mount(DiscoverWorkout);
    } else await mount(() => createElement(SharedSnapshot, { snapshot }));
    const text = () => nodes("Copy").flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
    expect(text()).toContain("AMRAP · 20 min time cap");
    expect(text()).toContain("Rest after each round");
    expect(text()).toContain("Keep your back steady");
    expect(text().toLowerCase()).not.toContain("rounds not specified");
    expect(text().toLowerCase()).not.toMatch(/sets not specified|unspecified sets/);

    // An ordinary fixed-round prescription retains its existing presentation.
    const fixed: Workout = { ...workout, blocks: [{ ...workout.blocks[0], execution: undefined, rounds: 3,
      exercises: [{ ...workout.blocks[0].exercises[0], sets: 2 }] }] };
    await act(async () => renderer!.unmount()); renderer = undefined;
    if (surface === "import") {
      const job = importJob("images"); fixture.importJob.mockResolvedValue({ ...job, result: { ...job.result, workout: fixed } });
      cache.clear(); await mount(ImportReview);
    } else if (surface === "plan") await mount(() => createElement(PrescriptionPreview, { workout: fixed }));
    else if (surface === "discover") {
      fixture.discoverWorkout.mockResolvedValue({ ...detail, estimated_minutes: null, workout: fixed }); cache.clear(); await mount(DiscoverWorkout);
    } else {
      const fixedSnapshot: ShareSnapshot = { ...snapshot, content: surface === "shared program"
        ? { title: "Source plan", sessions: [{ sequence: 1, day_offset: 0, workout: fixed }], notice: "Review this plan" } : fixed };
      await mount(() => createElement(SharedSnapshot, { snapshot: fixedSnapshot }));
    }
    expect(text()).toContain("3 rounds"); expect(text()).not.toContain("AMRAP");
    if (surface === "plan" || surface.startsWith("shared")) expect(text()).toContain("2 sets");
  });

it.each([true, false])("plan previews keep explicit sets and only omit unspecified sets for AMRAP=%s", async timed => {
  const workout: Workout = { ...saved, blocks: [{ id: "flow", label: "Main", grouping: "circuit",
    ...(timed ? { execution: { mode: "amrap" as const, time_cap_seconds: 1200 } } : {}),
    exercises: [{ name: "Swings", reps_min: 10, sets: 2 }, { name: "Squat", reps_min: 10 }] }] };
  await mount(() => createElement(PrescriptionPreview, { workout }));
  const text = nodes("Copy").flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
  expect(text).toContain("2 sets"); expect(text.includes("Sets not specified")).toBe(!timed);
});

it("deletes only after explicit confirmation and returns to the library", async () => {
  fixture.params = { id: saved.id };
  fixture.workout.mockResolvedValue(saved);
  fixture.deleteWorkout.mockResolvedValue(undefined);
  await mount(WorkoutDetail);
  await act(async () => nodes("Screen")[0].props.action.props.onPress());
  await act(async () => nodes("ListRow").find(n => n.props.title === "Delete workout")!.props.onPress());
  expect(fixture.deleteWorkout).not.toHaveBeenCalled();
  await act(async () => button("Keep workout")!.props.onPress());
  expect(fixture.deleteWorkout).not.toHaveBeenCalled();
  await act(async () => nodes("ListRow").find(n => n.props.title === "Delete workout")!.props.onPress());
  await act(async () => button("Delete workout")!.props.onPress());
  expect(fixture.deleteWorkout).toHaveBeenCalledWith(saved.id, saved.generation);
  expect(fixture.replace).toHaveBeenCalledWith("/(tabs)/library");
});

it("keeps a failed deletion available for retry", async () => {
  fixture.params = { id: saved.id }; fixture.workout.mockResolvedValue(saved);
  fixture.deleteWorkout.mockRejectedValue(new Error("Could not delete. Try again."));
  await mount(WorkoutDetail);
  await act(async () => nodes("Screen")[0].props.action.props.onPress());
  await act(async () => nodes("ListRow").find(n => n.props.title === "Delete workout")!.props.onPress());
  await act(async () => button("Delete workout")!.props.onPress());
  expect(fixture.replace).not.toHaveBeenCalled();
  expect(nodes("Notice").some(n => n.children.includes("Could not delete. Try again."))).toBe(true);
});

it("serializes deletion and suppresses navigation after an account change", async () => {
  fixture.params = { id: saved.id }; fixture.workout.mockResolvedValue(saved);
  let release!: () => void;
  fixture.deleteWorkout.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  await mount(WorkoutDetail);
  await act(async () => nodes("Screen")[0].props.action.props.onPress());
  await act(async () => nodes("ListRow").find(n => n.props.title === "Delete workout")!.props.onPress());
  const remove = button("Delete workout")!.props.onPress;
  await act(async () => { remove(); remove(); });
  expect(fixture.deleteWorkout).toHaveBeenCalledTimes(1);
  fixture.current = false;
  await act(async () => { release(); });
  await settle();
  expect(fixture.replace).not.toHaveBeenCalled();
  expect(fixture.toast).not.toHaveBeenCalled();
});

it("surfaces collection filters and management directly beside library search", async () => {
  fixture.collections.mockResolvedValue([{ id: "gym", title: "Gym days", workout_count: 2 }]);
  fixture.searchLibrary.mockResolvedValue({ items: [saved], total: 1, has_more: false });
  await mount(Library);
  expect(button("Manage collections")).toBeDefined();
  const chips = nodes("ChipRow").find(node => node.props.label === "Collections")!;
  await act(async () => chips.findAllByType("Chip" as never).find(node => node.props.label === "Gym days")!.props.onPress()); await settle();
  expect(fixture.searchLibrary.mock.calls.at(-1)![0].collection_id).toBe("gym");
});
it("bulk organization keeps only failed workouts selected and retries only those", async () => {
  const second = { ...saved, id: "copy-2", title: "Second workout" };
  fixture.collections.mockResolvedValue([{ id: "gym", title: "Gym days", workout_count: 0 }]);
  fixture.searchLibrary.mockResolvedValue({ items: [saved, second], total: 2, has_more: false });
  fixture.organization.mockResolvedValue({ ...emptyOrganization(), revision: 3, collection_ids: ["existing"] });
  let fail = true;
  fixture.saveOrganization.mockImplementation(async (id, body) => {
    if (id === second.id && fail) { fail = false; throw Error("Temporary save failure"); }
    return { ...emptyOrganization(), revision: 4, collection_ids: body.collection_ids };
  });
  await mount(Library); await act(async () => button("Select workouts")!.props.onPress());
  await act(async () => { choice(saved.title)!.props.onPress(); choice(second.title)!.props.onPress(); });
  await act(async () => button("Add selected to collection")!.props.onPress());
  const press = button("Add to collection")!.props.onPress;
  await act(async () => { press(); press(); }); await settle();
  expect(fixture.saveOrganization).toHaveBeenCalledTimes(2);
  expect(choice(saved.title)!.props.selected).toBe(false); expect(choice(second.title)!.props.selected).toBe(true);
  await act(async () => button("Retry remaining workouts")!.props.onPress()); await settle();
  expect(fixture.saveOrganization.mock.calls.map(([id]) => id)).toEqual([saved.id, second.id, second.id]);
  expect(fixture.saveOrganization.mock.calls[2][1]).toEqual({ expected_revision: 3, collection_ids: ["existing", "gym"] });
  expect(button("Select workouts")).toBeDefined();
});
it("a direct favorite reads its current private revision and preserves memberships, tags and archive state", async () => {
  fixture.params = { id: saved.id }; fixture.capabilities.mockResolvedValue(caps(false));
  const original = { ...emptyOrganization(), revision: 1, collection_ids: ["original"], tags: ["Private"] };
  fixture.workout.mockResolvedValue({ ...saved, organization: original });
  let resolve!: (organization: ReturnType<typeof emptyOrganization>) => void;
  fixture.organization.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const latest = { ...original, revision: 7, archived: true, collection_ids: ["original", "another"] };
  fixture.saveOrganization.mockResolvedValue({ ...latest, revision: 8, favorite: true });
  await mount(WorkoutDetail);
  const press = button("Favorite workout")!.props.onPress;
  await act(async () => { press(); press(); }); expect(fixture.organization).toHaveBeenCalledTimes(1);
  await act(async () => resolve(latest)); await settle();
  expect(fixture.saveOrganization).toHaveBeenCalledExactlyOnceWith(saved.id, { expected_revision: 7, favorite: true }, 1);
  expect(cache.getQueryData<Workout>(["owner", "workout", saved.id, 1])?.organization).toEqual({ ...latest, revision: 8, favorite: true });
  expect(button("Remove favorite")).toBeDefined(); expect(button("Organize workout")).toBeDefined();
});
it("a retired account cannot continue a held bulk add", async () => {
  fixture.collections.mockResolvedValue([{ id: "gym", title: "Gym", workout_count: 0 }]);
  fixture.searchLibrary.mockResolvedValue({ items: [saved], total: 1, has_more: false });
  let resolve!: (organization: ReturnType<typeof emptyOrganization>) => void;
  fixture.organization.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount(Library); await act(async () => button("Select workouts")!.props.onPress());
  await act(async () => choice(saved.title)!.props.onPress()); await act(async () => button("Add selected to collection")!.props.onPress());
  await act(async () => button("Add to collection")!.props.onPress()); fixture.current = false;
  await act(async () => resolve(emptyOrganization())); await settle();
  expect(fixture.saveOrganization).not.toHaveBeenCalled();
});

it("a direct favorite stops before writing when the account retires during its metadata read", async () => {
  fixture.params = { id: saved.id }; fixture.capabilities.mockResolvedValue(caps(false));
  fixture.workout.mockResolvedValue({ ...saved, organization: emptyOrganization() });
  let resolve!: (organization: ReturnType<typeof emptyOrganization>) => void;
  fixture.organization.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount(WorkoutDetail); await act(async () => button("Favorite workout")!.props.onPress());
  fixture.current = false; await act(async () => resolve(emptyOrganization())); await settle();
  expect(fixture.saveOrganization).not.toHaveBeenCalled();
  expect(cache.getQueryData<Workout>(["owner", "workout", saved.id, 1])?.organization?.favorite).toBe(false);
});

it("a new enrollment resets private bulk selection and fences an old in-flight result", async () => {
  fixture.collections.mockResolvedValue([{ id: "gym", title: "Gym", workout_count: 0 }]);
  fixture.searchLibrary.mockResolvedValue({ items: [saved], total: 1, has_more: false });
  let resolve!: (organization: ReturnType<typeof emptyOrganization>) => void;
  fixture.organization.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount(Library); await act(async () => button("Select workouts")!.props.onPress());
  await act(async () => choice(saved.title)!.props.onPress()); await act(async () => button("Add selected to collection")!.props.onPress());
  await act(async () => button("Add to collection")!.props.onPress());
  fixture.generation = 2; fixture.searchLibrary.mockResolvedValue({ items: [], total: 0, has_more: false });
  await act(async () => renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(Library)))); await settle();
  await act(async () => resolve(emptyOrganization())); await settle();
  expect(fixture.saveOrganization).not.toHaveBeenCalled(); expect(button("Select workouts")).toBeDefined();
  expect(nodes("Sheet").find(node => node.props.title === "Add workouts to a collection")!.props.visible).toBe(false);
});

it("freezes a pending bulk target and selection despite captured controls and changing filters", async () => {
  const second = { ...saved, id: "second", title: "Second workout" };
  fixture.collections.mockResolvedValue([{ id: "gym", title: "Gym", workout_count: 0 }, { id: "home", title: "Home", workout_count: 0 }]);
  fixture.searchLibrary.mockResolvedValue({ items: [saved, second], total: 2, has_more: false });
  let resolve!: (organization: ReturnType<typeof emptyOrganization>) => void;
  fixture.organization.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(emptyOrganization());
  fixture.saveOrganization.mockImplementation(async (_id, body) => ({ ...emptyOrganization(), revision: 1, collection_ids: body.collection_ids }));
  await mount(Library); await act(async () => button("Select workouts")!.props.onPress());
  const selectSecond = choice(second.title)!.props.onPress;
  await act(async () => choice(saved.title)!.props.onPress()); await act(async () => button("Add selected to collection")!.props.onPress());
  const chooseHome = choice("Home")!.props.onPress;
  const doneSelecting = button("Done selecting")!.props.onPress;
  await act(async () => button("Add to collection")!.props.onPress());
  await act(async () => { selectSecond(); chooseHome(); doneSelecting(); });
  const chips = nodes("ChipRow").find(node => node.props.label === "Collections")!;
  await act(async () => chips.findAllByType("Chip" as never).find(node => node.props.label === "Home")!.props.onPress()); await settle();
  await act(async () => resolve(emptyOrganization())); await settle();
  expect(fixture.saveOrganization).toHaveBeenCalledExactlyOnceWith(saved.id, { expected_revision: 0, collection_ids: ["gym"] }, 1);
  expect(fixture.searchLibrary.mock.calls.at(-1)![0].collection_id).toBe("home");
});

it("keeps an organization conflict pending until the user explicitly retries the remaining selection", async () => {
  fixture.collections.mockResolvedValue([{ id: "gym", title: "Gym", workout_count: 0 }]);
  fixture.searchLibrary.mockResolvedValue({ items: [saved], total: 1, has_more: false });
  fixture.organization.mockResolvedValueOnce({ ...emptyOrganization(), revision: 1 })
    .mockResolvedValue({ ...emptyOrganization(), revision: 2, favorite: true, collection_ids: ["concurrent"] });
  fixture.saveOrganization.mockRejectedValueOnce(new ApiError("Organization changed. Review and retry.", 409))
    .mockResolvedValue({ ...emptyOrganization(), revision: 3, collection_ids: ["concurrent", "gym"] });
  await mount(Library); await act(async () => button("Select workouts")!.props.onPress());
  await act(async () => choice(saved.title)!.props.onPress()); await act(async () => button("Add selected to collection")!.props.onPress());
  await act(async () => button("Add to collection")!.props.onPress()); await settle();
  expect(choice(saved.title)!.props.selected).toBe(true);
  expect(fixture.saveOrganization).toHaveBeenCalledTimes(1); expect(fixture.organization).toHaveBeenCalledTimes(1);
  expect(button("Retry remaining workouts")).toBeDefined();
  await act(async () => button("Retry remaining workouts")!.props.onPress()); await settle();
  expect(fixture.saveOrganization.mock.calls[1]).toEqual([saved.id, { expected_revision: 2, collection_ids: ["concurrent", "gym"] }, 1]);
});
