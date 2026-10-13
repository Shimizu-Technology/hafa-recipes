import { createElement, type ComponentType } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import type { DiscoverDetail, DiscoverPage } from "./discover";
import type { Workout } from "./models";

const fixture = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  capabilities: vi.fn(),
  discover: vi.fn(),
  discoverWorkout: vi.fn(),
  saveDiscovered: vi.fn(),
  workout: vi.fn(),
  importJob: vi.fn(),
  importSource: vi.fn(),
  acceptImport: vi.fn(),
  publishingDisclosure: vi.fn(),
  acceptPublishingDisclosure: vi.fn(),
  agree: true,
  asked: 0,
  push: vi.fn(),
  replace: vi.fn(),
  toast: vi.fn(),
  map: new Map<string, string>(),
  focus: false,
  current: true,
  load: vi.fn(),
}));
vi.mock("@/lib/context", () => {
  const storage = {
    isCurrent: () => true,
    removeItem: async (key: string) => void fixture.map.delete(key),
    getItem: async (key: string) => fixture.map.get(key) ?? null,
    setItem: async (key: string, value: string) => void fixture.map.set(key, value),
  };
  const localDrafts = { load: fixture.load, save: async () => undefined, remove: async () => undefined };
  const api = {
    capabilities: fixture.capabilities,
    discover: fixture.discover,
    discoverWorkout: fixture.discoverWorkout,
    saveDiscovered: fixture.saveDiscovered,
    workout: fixture.workout,
    importJob: fixture.importJob,
    importSource: fixture.importSource,
    acceptImport: fixture.acceptImport,
    cancelImport: vi.fn(),
    publishingDisclosure: fixture.publishingDisclosure,
    acceptPublishingDisclosure: fixture.acceptPublishingDisclosure,
  };
  return {
    useTraining: () => ({
      api,
      owner: "owner",
      enrollment: { enrolled: true, generation: 1 },
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
  View: "View",
  Image: "Image",
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  Linking: { openURL: vi.fn(async () => undefined) },
}));
vi.mock("expo-router", async () => {
  const { useEffect } = await import("react");
  return ({
  router: { push: fixture.push, replace: fixture.replace, back: vi.fn(), navigate: vi.fn() },
  useFocusEffect(callback: () => (() => void) | void) { useEffect(() => fixture.focus ? callback() : undefined, [callback]); },
  useLocalSearchParams: () => fixture.params,
}); });
vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
vi.mock("@/components/ui", () => {
  const names = ["AccountButton", "Button", "Card", "Chip", "ChipRow", "Choice", "Copy", "Empty", "Field", "IconButton",
    "ListGroup", "ListRow", "Notice", "Row", "Screen", "SectionHeader", "Sheet", "Skeleton", "SkeletonCard", "Stack", "StatTile"];
  return { ...Object.fromEntries(names.map((name) => [name, name])), useToast: () => fixture.toast };
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

let renderer: ReactTestRenderer | undefined, cache: QueryClient;
const nodes = (type: string) => renderer!.root.findAll((n) => String(n.type) === type);
const button = (title: string) => nodes("Button").find((n) => n.props.title === title);
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
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  for (const mock of [fixture.capabilities, fixture.discover, fixture.discoverWorkout, fixture.saveDiscovered, fixture.workout,
    fixture.importJob, fixture.importSource, fixture.acceptImport, fixture.publishingDisclosure, fixture.acceptPublishingDisclosure,
    fixture.push, fixture.replace, fixture.toast]) mock.mockReset();
  fixture.params = {};
  fixture.focus = false;
  fixture.current = true;
  fixture.load.mockReset().mockImplementation(async (_owner, scope) => scope.startsWith("imports:") && fixture.params.auto === "1"
    ? [{ id: "job", label: "Shared link", generation: 1, auto_save: true }] : null);
  fixture.agree = true;
  fixture.asked = 0;
  fixture.importSource.mockResolvedValue({ images: [], text: "" });
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
it.each(["missing", "warning", "coverage"])("keeps %s results for an explicit save rather than guessing", async (kind) => {
  fixture.focus = true;
  fixture.params = { id: "job", auto: "1" };
  const job = importJob("url", kind === "missing" ? "incomplete" : "ready");
  if (kind === "warning") job.result.warnings = ["Rounds unknown"] as never[];
  if (kind === "coverage") job.result.source.coverage_notes = ["Only the beginning was available"] as never[];
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
