import WorkoutDetail from "../app/workout/[id]";
import { WorkoutSource } from "../components/workout-source";
import { createElement, Fragment, isValidElement, type ComponentType, type PropsWithChildren, type ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import type { DiscoverDetail, DiscoverPage } from "./discover";
import { emptyOrganization } from "./organization";
import type { Workout } from "./models";

const fixture = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  library: vi.fn(),
  capabilities: vi.fn(),
  discover: vi.fn(),
  discoverRandom: vi.fn(),
  discoverContributors: vi.fn(),
  discoverWorkout: vi.fn(),
  saveDiscovered: vi.fn(),
  blockDiscoverContributor: vi.fn(),
  workout: vi.fn(),
  deleteWorkout: vi.fn(),
  unpublishWorkout: vi.fn(),
  publishWorkout: vi.fn(),
  back: vi.fn(),
  navigate: vi.fn(),
  announce: vi.fn(),
  share: vi.fn(),
  active: null as null | { workout: { title: string }; source: { workout_id: string; workout_revision: number } },
  importJob: vi.fn(),
  importJobs: vi.fn(),
  searchLibrary: vi.fn(), collections: vi.fn(), createCollection: vi.fn(), renameCollection: vi.fn(), removeCollection: vi.fn(), organization: vi.fn(), saveOrganization: vi.fn(),
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
  current: true, generation: 1, owner: "owner",
  load: vi.fn(),
  saveDraft: vi.fn(),
  start: vi.fn(),
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
    library: fixture.library,
    capabilities: fixture.capabilities,
    discover: fixture.discover,
    discoverRandom: fixture.discoverRandom,
    discoverContributors: fixture.discoverContributors,
    discoverWorkout: fixture.discoverWorkout,
    saveDiscovered: fixture.saveDiscovered,
    blockDiscoverContributor: fixture.blockDiscoverContributor,
    workout: fixture.workout,
    deleteWorkout: fixture.deleteWorkout,
    unpublishWorkout: fixture.unpublishWorkout,
    publishWorkout: fixture.publishWorkout,
    importJob: fixture.importJob,
    importJobs: fixture.importJobs,
    searchLibrary: fixture.searchLibrary, collections: fixture.collections, createCollection: fixture.createCollection, renameCollection: fixture.renameCollection, removeCollection: fixture.removeCollection, organization: fixture.organization, saveOrganization: fixture.saveOrganization,
    importSource: fixture.importSource,
    acceptImport: fixture.acceptImport,
    cancelImport: fixture.cancelImport,
    publishingDisclosure: fixture.publishingDisclosure,
    acceptPublishingDisclosure: fixture.acceptPublishingDisclosure,
  };
  return {
    useOfflineTraining: () => ({ ready: true, state: { active: fixture.active, history: [] }, store: { start: fixture.start, snapshot: () => ({ active: fixture.active, history: [] }) } }),
    useTraining: () => ({
      api,
      owner: fixture.owner,
      enrollment: { enrolled: true, generation: fixture.generation },
      storage,
      localDrafts,
      isCurrentAccount: () => fixture.current,
    }),
  };
});
vi.mock("@/components/native-tab-stack", () => ({ BrowseHeader: "BrowseHeader" }));
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
  Platform: { OS: "web" },
  Share: { share: (content: { message: string }) => fixture.share(content) },
  ActivityIndicator: "ActivityIndicator",
  View: "View",
  Image: "Image",
  ScrollView: "ScrollView",
  // Renders every row so tests see the cards; the real list virtualizes.
  FlatList: ({ data, renderItem, keyExtractor, ListHeaderComponent, ListEmptyComponent, ListFooterComponent, ...props }: {
    data: Array<{ id: string }>; renderItem(row: { item: unknown; index: number }): ReactNode; keyExtractor(item: unknown): string;
    ListHeaderComponent?: ReactNode; ListEmptyComponent?: ReactNode; ListFooterComponent?: ReactNode;
  }) => createElement("FlatList", props, ListHeaderComponent, data.length
    ? data.map((item, index) => createElement(Fragment, { key: keyExtractor(item) }, renderItem({ item, index }))) : ListEmptyComponent,
  ListFooterComponent),
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
  AppState: { get currentState() { return fixture.appState; }, addEventListener: (_event: string, listener: (state: string) => void) => {
    fixture.appStateListeners.add(listener); return { remove() { fixture.appStateListeners.delete(listener); } };
  } },
  Linking: { openURL: vi.fn(async () => undefined) },
  AccessibilityInfo: { announceForAccessibility: (text: string) => fixture.announce(text) },
}));
vi.mock("expo-router", async () => {
  const { useEffect } = await import("react");
  return ({
  Stack: { Screen: "NativeHeader" },
  router: { push: fixture.push, replace: fixture.replace, back: fixture.back, canGoBack: () => true, navigate: fixture.navigate },
  useFocusEffect(callback: () => (() => void) | void) { useEffect(() => fixture.focus ? callback() : undefined, [callback, fixture.focus]); },
  useLocalSearchParams: () => fixture.params,
}); });
vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
vi.mock("@/components/ui", () => {
  const names = ["AccountButton", "Button", "Card", "Chip", "ChipRow", "Choice", "Copy", "Empty", "Field", "Grow", "IconButton",
    "ListGroup", "ListRow", "MediaCard", "Notice", "Row", "Screen", "SectionHeader", "Sheet", "Skeleton", "SkeletonCard", "Stack", "StatTile"];
  return { ...Object.fromEntries(names.map((name) => [name, name])),
    Screen: ({ children, footer, list, ...props }: PropsWithChildren<{ footer?: ReactNode; list?: (body: object) => ReactNode; [key: string]: unknown }>) =>
      createElement("Screen", props, createElement("ScreenAction", null, props.action as ReactNode), list?.({ header: null, contentContainerStyle: {} }), children, footer),
    haptics: { tick() {} }, useColors: () => new Proxy({}, { get: (_target, key) => String(key) }),
    useToast: () => fixture.toast };
});
vi.mock("@/components/discover-card", () => ({
  DiscoverCardView: "DiscoverCardView",
  DiscoverCardSkeleton: "DiscoverCardSkeleton",
  SourceArtwork: "SourceArtwork",
  CreditLine: "CreditLine",
}));
vi.mock("../components/source-player", () => ({ SourcePlayerModal: "SourcePlayerModal" }));
vi.mock("@/components/library-card", () => ({ LibraryCard: "LibraryCard", CollectionTile: "CollectionTile", LIBRARY_GRID_GAP: 12 }));
vi.mock("@/components/library-search", () => ({ LibrarySearch: "LibrarySearch" }));
vi.mock("@/components/discover-grid-card", () => ({
  DiscoverGrid: "DiscoverGrid",
  DiscoverGridCard: "DiscoverGridCard",
  DiscoverGridSkeleton: "DiscoverGridSkeleton",
}));
vi.mock("@/components/query-state", () => ({ QueryState: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/workout-editor", () => ({ WorkoutEditor: "WorkoutEditor" }));
vi.mock("@/components/source-image", () => ({ SourceImage: "SourceImage" }));
vi.mock("@/components/workout-start-sheet", () => ({ WorkoutStartSheet: "WorkoutStartSheet" }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("@/components/design/press", () => ({ animatedPressableComponent: () => "Pressable",
  usePressScale: () => ({ onPressIn() {}, onPressOut() {}, scale: 1, opacity: 1 }) }));
vi.mock("@/lib/capture-io", () => ({ cleanupCaptureFiles: vi.fn() }));
import Discover from "../app/(tabs)/discover/index";
import DiscoverWorkout from "../app/discover/[id]";
import ShareToDiscover from "../app/discover/share";
import ImportReview from "../app/import/[id]";
import Library from "../app/(tabs)/library/index";
import Collections from "../app/collections";
import CollectionDetail from "../app/collection/[id]";
import { ImportList } from "../components/import-list";
import { PrescriptionPreview } from "../components/program-preview";
import { SharedSnapshot } from "../components/shared-snapshot";
import type { ShareSnapshot } from "./sharing";

let renderer: ReactTestRenderer | undefined, cache: QueryClient;
const nodes = (type: string) => renderer!.root.findAll((n) => String(n.type) === type);
const button = (title: string) => nodes("Button").find((n) => n.props.title === title);
const row = (title: string) => nodes("ListRow").find((n) => n.props.title === title);
const metaLine = () => nodes("Copy").find((n) => n.props.tone === "muted" && n.props.kind === undefined)?.children.join("");
const header = (label: string) => nodes("ScreenAction")[0]?.findAll((n) => String(n.type) === "IconButton" && n.props.label === label)[0];
it("omits an empty reference card when source identity is already in the header", async () => {
  await act(async () => { renderer = create(createElement(WorkoutSource, { source: {
    source_thumbnail_url: "https://example.test/cover.jpg", source_url: "https://example.test/source",
  }, showIdentity: false, showOriginal: false })); });
  expect(nodes("Card")).toHaveLength(0);
});
it.each(["session", "exercise", "accessory"] as const)("a saved %s schedules that workout once", async (kind) => {
  fixture.params = { id: "saved-1" };
  fixture.workout.mockResolvedValue({ id: "saved-1", revision: 1, generation: 1, title: "Saved session",
    kind, provenance: "user", blocks: [{ id: "b", label: "Main", grouping: "sequential",
      exercises: [{ name: "Squat", sets: 3, reps_min: 8 }] }], equipment_required: [] });
  await mount(WorkoutDetail);
  const action = nodes("ListRow").find((n) => n.props.title === "Schedule");
  expect(action).toBeDefined();
  await act(async () => action!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/schedule-once", params: { workout_id: "saved-1" } });
});
/** Finds a Button inside an element passed as a prop (e.g. Empty's action), which the string mocks don't render. */
function actionButton(element: unknown, title: string): { props: { onPress(): void } } | undefined {
  if (Array.isArray(element)) return element.map((child) => actionButton(child, title)).find(Boolean);
  if (!isValidElement<{ title?: string; children?: unknown; onPress(): void }>(element)) return undefined;
  return element.props.title === title ? element : actionButton(element.props.children, title);
}
const emptyAction = (title: string) => actionButton(nodes("Empty")[0].props.action, title);
type HeaderAction = { props: { label: string; icon: string; onPress(): void } };
/** IconButtons passed in Screen's `action` prop, which the Screen mock doesn't render. */
function headerActions(element: unknown = nodes("Screen")[0].props.action): HeaderAction[] {
  if (Array.isArray(element)) return element.flatMap((child) => headerActions(child));
  if (!isValidElement<{ label?: string; children?: unknown }>(element)) return [];
  return element.type === "IconButton" ? [element as unknown as HeaderAction] : headerActions(element.props.children);
}
const headerAction = (label: string) => headerActions().find((n) => n.props.label.startsWith(label));
const choice = (label: string) => nodes("Choice").find((n) => n.props.label === label);
const listRow = (title: string) => nodes("ListRow").find((n) => n.props.title === title);
const libraryCard = (title: string) => nodes("LibraryCard").find((n) => n.props.title === title);
const filterChoice = (label: string) => nodes("Sheet").find((n) => n.props.title === "Filter workouts")!
  .findAll((n) => String(n.type) === "Choice" && n.props.label === label)[0];
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
  fixture.library.mockReset().mockResolvedValue([]);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  for (const mock of [fixture.capabilities, fixture.discover, fixture.discoverWorkout, fixture.saveDiscovered, fixture.workout,
    fixture.importJob, fixture.importSource, fixture.acceptImport, fixture.publishingDisclosure, fixture.acceptPublishingDisclosure,
    fixture.push, fixture.replace, fixture.back, fixture.toast, fixture.cancelImport, fixture.deleteWorkout, fixture.blockDiscoverContributor,
    fixture.unpublishWorkout, fixture.announce, fixture.start, fixture.publishWorkout, fixture.navigate, fixture.share]) mock.mockReset();
  fixture.params = {};
  fixture.discoverRandom.mockReset();
  fixture.discoverContributors.mockReset().mockResolvedValue([]);
  fixture.focus = false;
  fixture.active = null;
  fixture.appState = "active"; fixture.appStateListeners.clear();
  fixture.current = true; fixture.generation = 1; fixture.owner = "owner";
  fixture.load.mockReset().mockImplementation(async (_owner, scope) => fixture.map.has(scope) ? JSON.parse(fixture.map.get(scope)!)
    : scope.startsWith("imports:") && fixture.params.auto === "1" ? [{ id: "job", label: "Shared link", generation: 1, auto_save: true }] : null);
  fixture.saveDraft.mockReset().mockImplementation(async (_owner, scope, value) => { fixture.map.set(scope, JSON.stringify(value)); });
  fixture.agree = true;
  fixture.asked = 0;
  fixture.importSource.mockResolvedValue({ images: [], text: "" });
  fixture.importJobs.mockReset().mockResolvedValue([]);
  fixture.collections.mockReset().mockResolvedValue([]); fixture.searchLibrary.mockReset();
  fixture.createCollection.mockReset(); fixture.renameCollection.mockReset(); fixture.removeCollection.mockReset();
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

it("renders feed cards, passes an abort signal, and accepts Discover search links", async () => {
  fixture.capabilities.mockResolvedValue(caps(true));
  fixture.discover.mockResolvedValue(page());
  await mount(Discover);
  expect([...new Set(nodes("DiscoverGridCard").map((n) => n.props.card.id))]).toEqual(["pub-1"]);
  expect(fixture.discover).toHaveBeenCalledTimes(1);
  expect(fixture.discover.mock.calls[0][1]).toBe(0);
  expect(fixture.discover.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
  fixture.params = { q: "legs" };
  await act(async () => renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(Discover))));
  await settle();
  expect(fixture.discover).toHaveBeenCalledTimes(2);
  expect(fixture.discover.mock.calls[1][0]).toMatchObject({ q: "legs" });
});

it("shows a narrowed empty state with a way to clear filters", async () => {
  fixture.capabilities.mockResolvedValue(caps(true));
  fixture.discover.mockResolvedValue(page([]));
  await mount(Discover);
  expect(nodes("Empty")[0].props.title).toBe("Discover is just getting started");
  await act(async () => nodes("Chip").find((n) => n.props.label === "No equipment")!.props.onPress());
  await settle();
  expect(fixture.discover.mock.calls.at(-1)![0]).toMatchObject({ equipment: "none" });
  expect(nodes("Empty")[0].props.title).toBe("No workouts match");
  await act(async () => emptyAction("Clear search and filters")!.props.onPress());
  await settle();
  expect(nodes("Empty")[0].props.title).toBe("Discover is just getting started");
});

it("a young feed explains Discover and offers sharing or importing instead of a dead end", async () => {
  fixture.capabilities.mockResolvedValue(caps(true));
  fixture.discover.mockResolvedValue(page([]));
  await mount(Discover);
  const empty = nodes("Empty")[0];
  expect(empty.props.description).toContain("workouts Håfa members choose to share");
  expect(nodes("IconButton").find((n) => n.props.icon === "add")).toBeUndefined();
  await act(async () => emptyAction("Share one of yours")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith("/discover/share");
  await act(async () => emptyAction("Import a workout")!.props.onPress());
  expect(fixture.navigate).toHaveBeenCalledWith("/extract");
});

it("keeps all Discover filters in one sheet and one dismissible summary", async () => {
  fixture.capabilities.mockResolvedValue(caps(true)); fixture.discover.mockResolvedValue(page());
  await mount(Discover);
  await act(async () => button("Filter")!.props.onPress());
  expect(sheet("Filters").props.visible).toBe(true);
  for (const label of ["Under 15 min", "Dumbbell", "YouTube"]) await act(async () => nodes("Chip").find(n => n.props.label === label)!.props.onPress());
  await settle();
  expect(fixture.discover.mock.calls.at(-1)![0]).toMatchObject({ duration: "short", equipment: "dumbbell", platform: "youtube" });
  const summary = nodes("Button").find(n => String(n.props.title).endsWith(" · Clear"))!;
  expect(summary.props.title).toContain("Under 15 min · Dumbbell · YouTube");
  await act(async () => summary.props.onPress()); await settle();
  expect(nodes("Button").some(n => String(n.props.title).endsWith(" · Clear"))).toBe(false);
});

it("keeps sharing one of yours reachable once the feed has workouts", async () => {
  fixture.capabilities.mockResolvedValue(caps(true));
  fixture.discover.mockResolvedValue(page());
  await mount(Discover);
  await act(async () => button("Share yours")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith("/discover/share");
});

it("the share picker keeps reading pages until it finds a private workout", async () => {
  const shared = (id: string) => ({ ...saved, id, title: id, publication: { is_public: true, discover_visible: true,
    moderation_status: "active" as const, published_at: "2026-10-13T02:00:00Z" } });
  fixture.searchLibrary
    .mockResolvedValueOnce({ items: [shared("a"), shared("b")], total: 3, limit: 2, offset: 0, has_more: true, next_cursor: "c1" })
    .mockResolvedValueOnce({ items: [{ ...saved, id: "c", title: "Private one", publication: null }], total: 3, limit: 2, offset: 2, has_more: false, next_cursor: null });
  await mount(ShareToDiscover);
  expect(fixture.searchLibrary).toHaveBeenCalledTimes(2);
  expect(nodes("ListRow").map((n) => n.props.title)).toEqual(["Private one"]);
  expect(nodes("Notice")).toHaveLength(0);
});

it("Surprise me opens a random shared workout that matches the filters, and says so when nothing does", async () => {
  fixture.capabilities.mockResolvedValue(caps(true));
  fixture.discover.mockResolvedValue(page());
  fixture.discoverRandom.mockResolvedValueOnce(card).mockRejectedValueOnce(new ApiError("No shared workouts match yet", 404));
  await mount(Discover);
  await act(async () => nodes("Chip").find((n) => n.props.label === "No equipment")!.props.onPress());
  await settle();
  await act(async () => button("Surprise me")!.props.onPress());
  await settle();
  expect(fixture.discoverRandom).toHaveBeenCalledWith(expect.objectContaining({ equipment: "none" }));
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/discover/[id]", params: { id: "pub-1" } });
  await act(async () => button("Surprise me")!.props.onPress());
  await settle();
  expect(fixture.toast).toHaveBeenCalledWith("Nothing matches these filters yet", "info");
  expect(fixture.push).toHaveBeenCalledTimes(1);
  fixture.discoverRandom.mockRejectedValueOnce(new ApiError("socket hang up 0x1f", 0));
  await act(async () => button("Surprise me")!.props.onPress());
  await settle();
  expect(fixture.toast).toHaveBeenLastCalledWith("Couldn’t pick a workout. Check your connection and try again.", "error");
});

it("shows who is sharing and narrows the feed to one person, removable like any filter", async () => {
  fixture.capabilities.mockResolvedValue(caps(true));
  fixture.discover.mockResolvedValue(page());
  fixture.discoverContributors.mockResolvedValue([
    { contributor_id: "chef_leon1234", display_name: "Leon", workout_count: 4, is_you: false },
    { contributor_id: "chef_mine5678", display_name: "Me", workout_count: 1, is_you: true },
  ]);
  await mount(Discover);
  const sheet = nodes("Sheet").find(n => n.props.title === "Filters")!;
  expect(sheet.props.visible).toBe(false);
  await act(async () => button("Filter")!.props.onPress());
  expect(nodes("Sheet").find(n => n.props.title === "Filters")!.props.visible).toBe(true);
  const strip = () => nodes("ChipRow").find((n) => n.props.label === "People")!;
  const people = () => strip().findAll((n) => String(n.type) === "Chip");
  expect(people().map((n) => n.props.label)).toEqual(["Leon (4)", "You (1)"]);
  await act(async () => people()[0].props.onPress());
  await settle();
  expect(fixture.discover.mock.calls.at(-1)![0]).toMatchObject({ contributor: "chef_leon1234" });
  const summary = nodes("Button").find(n => String(n.props.title).endsWith(" · Clear"))!;
  expect(summary.props.title).toContain("by Leon");
  expect(people()[0].props.selected).toBe(true);
  await act(async () => summary.props.onPress()); await settle();
  expect(people()[0].props.selected).toBe(false);
});

it("switches between grid and list and remembers the choice for this account", async () => {
  fixture.capabilities.mockResolvedValue(caps(true));
  fixture.discover.mockResolvedValue(page());
  await mount(Discover);
  const toggle = () => nodes("ListRow").find((n) => /as a (list|grid)/.test(n.props.title))!;
  expect(toggle().props.title).toBe("Show workouts as a list");
  await act(async () => toggle().props.onPress());
  await settle();
  expect(nodes("DiscoverGridCard")).toHaveLength(0);
  expect(row(card.title)).toBeDefined();
  expect(fixture.map.get("hafa-workouts:v1:owner:discover-view")).toBe("list");
  await act(async () => renderer!.unmount());
  await mount(Discover);
  expect(toggle().props.title).toBe("Show workouts as a grid");
  expect(row(card.title)).toBeDefined();
});

it("shares a private library workout to Discover from the picker, asking for the disclosure once", async () => {
  const privateOne = { ...saved, id: "w-private", title: "Morning mobility", publication: null };
  const sharedOne = { ...saved, id: "w-shared", title: "Already out there",
    publication: { is_public: true, discover_visible: true, moderation_status: "active" as const, published_at: "2026-10-13T02:00:00Z" } };
  fixture.searchLibrary.mockResolvedValue({ items: [privateOne, sharedOne], total: 2, limit: 20, offset: 0, has_more: false, next_cursor: null });
  fixture.publishWorkout.mockRejectedValueOnce(new ApiError("Accept the publishing disclosure", 409, false, "Accept the current publishing disclosure"))
    .mockResolvedValueOnce({ is_public: true, discover_visible: true, moderation_status: "active", published_at: "2026-10-21T00:00:00Z" });
  fixture.publishingDisclosure.mockResolvedValue({ current_version: 2, accepted_version: 1, requires_acceptance: true });
  fixture.acceptPublishingDisclosure.mockResolvedValue({ current_version: 2, accepted_version: 2, requires_acceptance: false });
  await mount(ShareToDiscover);
  expect(nodes("ListRow").map((n) => n.props.title)).toEqual(["Morning mobility"]);
  await act(async () => nodes("ListRow")[0].props.onPress());
  await settle();
  expect(fixture.asked).toBe(1);
  expect(fixture.acceptPublishingDisclosure).toHaveBeenCalledWith(2);
  expect(fixture.publishWorkout).toHaveBeenCalledTimes(2);
  expect(fixture.publishWorkout).toHaveBeenLastCalledWith("w-private", 1);
  expect(fixture.toast).toHaveBeenCalledWith("Shared to Discover");
  expect(fixture.back).toHaveBeenCalled();
});

it("an incomplete workout explains what is missing and links to it from the share picker", async () => {
  const privateOne = { ...saved, id: "w-private", title: "Morning mobility", publication: null };
  fixture.searchLibrary.mockResolvedValue({ items: [privateOne], total: 1, limit: 20, offset: 0, has_more: false, next_cursor: null });
  fixture.publishWorkout.mockRejectedValue(new ApiError("Give every exercise reps", 422, false, "Give every exercise reps, time or distance before sharing to Discover"));
  await mount(ShareToDiscover);
  await act(async () => nodes("ListRow")[0].props.onPress());
  await settle();
  expect(nodes("Notice")[0].props.children).toMatch(/Every exercise needs reps, time or distance/);
  await act(async () => button("Open Morning mobility")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/workout/[id]", params: { id: "w-private" } });
  expect(fixture.back).not.toHaveBeenCalled();
});

it("an empty library points to importing before sharing", async () => {
  fixture.searchLibrary.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0, has_more: false, next_cursor: null });
  await mount(ShareToDiscover);
  expect(nodes("Empty")[0].props.title).toBe("Nothing to share yet");
  await act(async () => emptyAction("Import a workout")!.props.onPress());
  expect(fixture.navigate).toHaveBeenCalledWith("/extract");
});

it("saves from detail, then offers the saved workout and a plan", async () => {
  fixture.params = { id: "pub-1" };
  fixture.discoverWorkout.mockResolvedValue(detail);
  fixture.saveDiscovered.mockResolvedValue(saved);
  await mount(DiscoverWorkout);
  await act(async () => button("Save to library")!.props.onPress());
  await settle();
  expect(fixture.saveDiscovered).toHaveBeenCalledWith("pub-1", 1);
  expect(fixture.toast).toHaveBeenCalledWith("Saved to your library");
  expect(nodes("Sheet").find((n) => n.props.title === "Saved to your library")!.props.visible).toBe(true);
  await act(async () => button("Schedule")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/schedule-once", params: { workout_id: "copy-1" } });
  expect(button("Open in your library")).toBeDefined();
});

it("asks the coach about a Discover workout by saving a private copy first", async () => {
  fixture.params = { id: "pub-1" };
  fixture.discoverWorkout.mockResolvedValue(detail);
  fixture.saveDiscovered.mockResolvedValue(saved);
  await mount(DiscoverWorkout);
  await act(async () => headerAction("Ask the coach")!.props.onPress());
  await settle();
  expect(fixture.saveDiscovered).toHaveBeenCalledTimes(1);
  expect(fixture.toast).toHaveBeenCalledWith("Saved a private copy to your library");
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

it("workout detail reads at a glance, keeps each action in one place and confirms leaving Discover", async () => {
  fixture.params = { id: saved.id }; fixture.capabilities.mockResolvedValue(caps(true));
  const publication = { is_public: true, discover_visible: true, moderation_status: "active" as const, published_at: "2026-10-13T02:00:00Z" };
  fixture.workout.mockResolvedValue({ ...saved, estimated_minutes: 30, equipment_required: ["Dumbbells", "Bench"], publication });
  fixture.unpublishWorkout.mockResolvedValue({ ...publication, is_public: false, discover_visible: false });
  await mount(WorkoutDetail);
  // The page leads with its own hero, then the title and one meta line.
  expect(nodes("Screen")[0].props.hideTitle).toBe(true);
  expect(nodes("Copy").find((n) => n.props.kind === "title")!.children.join("")).toBe(saved.title);
  expect(metaLine()).toBe("30 min · 1 exercise · Dumbbells, Bench");
  expect(nodes("Screen")[0].props).not.toHaveProperty("eyebrow");
  expect(nodes("StatTile")).toHaveLength(0);
  // Contextual Coach is labelled in content; share and overflow stay in the header.
  expect(nodes("ScreenAction")[0].findAll((n) => String(n.type) === "IconButton").map((n) => n.props.label))
    .toEqual(["Share workout", "More workout actions"]);
  await act(async () => nodes("ListRow").find(n => n.props.title === "Ask about this workout")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/coach", params: { workout_id: saved.id, revision: String(saved.revision) } });
  await act(async () => header("Share workout")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/share", params: { id: saved.id, kind: "workout" } });
  for (const title of ["Favorite workout", "Organize workout", "Edit workout details", "Remove from Discover", "See it in Discover",
    "Version history", "Update from caption or link", "Delete workout"])
    expect(nodes("ListRow").filter((n) => n.props.title === title)).toHaveLength(1);
  expect(nodes("Button").filter((n) => !n.props.inline && n.props.size !== "lg").map((n) => n.props.title)).toEqual([]);
  expect(nodes("Button").filter((n) => n.props.size === "lg").map((n) => n.props.title)).toEqual(["Start workout"]);
  await act(async () => header("More workout actions")!.props.onPress());
  await act(async () => row("Remove from Discover")!.props.onPress()); await settle();
  expect(fixture.unpublishWorkout).toHaveBeenCalledWith(saved.id, saved.generation);
  const notice = nodes("Notice").find((n) => n.props.tone === "success")!;
  expect(notice.props.children).toBe("Removed from Discover. People who already saved it keep their copy.");
  expect(fixture.announce).toHaveBeenCalledWith(notice.props.children);
  expect(nodes("ListRow").find((n) => n.props.title === "Share to Discover")).toBeDefined();
});

it.each([true, false])("a program workout page resumes an active session but never starts the program as one workout (active=%s)", async active => {
  fixture.params = { id: saved.id }; fixture.capabilities.mockResolvedValue(caps(false));
  fixture.active = active ? { workout: { title: "Session in progress" }, source: { workout_id: "other", workout_revision: 1 } } : null;
  fixture.workout.mockResolvedValue({ ...saved, kind: "program" });
  await mount(WorkoutDetail);
  expect(button("Start workout")).toBeUndefined();
  expect(header("Share workout")).toBeUndefined();
  // Scheduling stays reachable from ··· even while another session holds the footer.
  await act(async () => row("Schedule as a plan")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/review-plan", params: { workout_id: saved.id } });
  const action = button(active ? "Resume current session" : "Schedule as a plan")!;
  expect(action.props.disabled).toBeFalsy();
  await act(async () => action.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith(active ? "/training" : { pathname: "/review-plan", params: { workout_id: saved.id } });
});

it("shows owners their own workout with unpublish and no save, report or block", async () => {
  fixture.params = { id: "pub-1" };
  fixture.discoverWorkout.mockResolvedValue({ ...detail, is_owner: true });
  await mount(DiscoverWorkout);
  expect(button("Save to library")).toBeUndefined();
  expect(nodes("ListRow").find((n) => n.props.title === "Remove from Discover")).toBeDefined();
  expect(headerActions().map((n) => n.props.label)).toEqual(["Share this workout"]);
  await act(async () => nodes("ListRow").find(n => n.props.title === "Schedule")!.props.onPress());
  expect(fixture.saveDiscovered).not.toHaveBeenCalled();
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/schedule-once", params: { workout_id: "pub-1" } });
});

it("Discover detail leads with the cover, keeps one primary save and tucks report and block into more options", async () => {
  fixture.params = { id: "pub-1" };
  fixture.discoverWorkout.mockResolvedValue({ ...detail, thumbnail_url: "https://example.test/cover.jpg" });
  fixture.share.mockResolvedValue({ action: "sharedAction" });
  await mount(DiscoverWorkout);
  const screen = nodes("Screen")[0];
  expect(screen.props.title).toBe("Ten minute legs");
  expect(screen.props.hideTitle).toBe(true);
  // The cover is the first body element (after the mock's rendering of the header actions).
  const first = (screen.children as ReactTestInstance[]).find((n) => String(n.type) !== "ScreenAction")!;
  expect(String(first.type)).toBe("View");
  expect(first.findAll((n) => String(n.type) === "SourceImage")).toHaveLength(1);
  expect(headerActions().map((n) => n.props.label)).toEqual([
    "Ask the coach about this workout. Saves a private copy first", "Share this workout", "More options"]);
  expect(nodes("Button").filter((n) => n.props.size === "lg").map((n) => n.props.title)).toEqual(["Save to library"]);
  expect(nodes("ListRow").filter((n) => /Report|Block/.test(n.props.title)).every((n) => {
    let parent = n.parent;
    while (parent && String(parent.type) !== "Sheet") parent = parent.parent;
    return parent?.props.title === "Workout options";
  })).toBe(true);
  await act(async () => headerAction("Share this workout")!.props.onPress());
  const message = fixture.share.mock.calls[0][0].message as string;
  expect(message).toContain("Ten minute legs\n10 min · 3 exercises · Dumbbell");
  expect(message).toContain("1. Goblet squat: 3 × 12 reps · 45s rest");
  expect(message).toContain("Original by Coach Nani on YouTube: https://www.youtube.com/watch?v=abc");
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
  await mount(() => createElement("Flow", null, createElement(Library), createElement(ImportList)));
  expect(fixture.importJobs).toHaveBeenCalledTimes(1); expect(nodes("LibraryCard")).toHaveLength(0);
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
  expect(fixture.searchLibrary).toHaveBeenCalledTimes(2); expect(nodes("LibraryCard")).toHaveLength(1);
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
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/edit-workout/[id]", params: { id: "saved", review: "1" } });
});
it("Library refreshes stale results on return and by pulling down, without refetching fresh data", async () => {
  fixture.capabilities.mockResolvedValue(caps(false));
  fixture.searchLibrary.mockResolvedValue({ items: [], total: 0, has_more: false });
  await mount(Library);
  expect(fixture.searchLibrary).toHaveBeenCalledTimes(1);
  const foreground = async () => { await act(async () => { for (const listener of [...fixture.appStateListeners]) listener("active"); }); await settle(); };
  await foreground();
  expect(fixture.searchLibrary).toHaveBeenCalledTimes(1); // Still fresh: loaded pages are not refetched.
  const now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
  fixture.searchLibrary.mockResolvedValue({ items: [saved], total: 1, has_more: false });
  await foreground();
  clock.mockRestore();
  expect(fixture.searchLibrary).toHaveBeenCalledTimes(2); expect(nodes("LibraryCard")).toHaveLength(1);
  await act(async () => nodes("Screen")[0].props.onRefresh()); await settle();
  expect(fixture.searchLibrary).toHaveBeenCalledTimes(3); expect(nodes("Screen")[0].props.refreshing).toBe(false);
});
it("Library cards retain the source cover and creator while marking unresolved source details", async () => {
  fixture.capabilities.mockResolvedValue(caps(false));
  fixture.searchLibrary.mockResolvedValue({ items: [{ ...saved, source_thumbnail_url: "https://example.test/cover.jpg",
    source_creator: "Creator", extraction_warnings: ["Rest unknown"] }], total: 1, has_more: false });
  await mount(Library);
  expect(nodes("LibraryCard")[0].props).toMatchObject({ view: "grid", image: "https://example.test/cover.jpg", badge: "Check details", creator: "Creator", origin: expect.any(String) });
});
it("Discover detail keeps the real cover instead of replacing it with generic artwork", async () => {
  fixture.params = { id: card.id };
  fixture.discoverWorkout.mockResolvedValue({ ...detail, thumbnail_url: "https://example.test/source-cover.jpg" });
  await mount(DiscoverWorkout);
  expect(nodes("SourceImage")[0].props).toMatchObject({ uri: "https://example.test/source-cover.jpg", cover: true, label: card.title });
  expect(nodes("SourceImage")[0].props.fallback).toBeDefined();
  expect(button("Save to library")).toBeDefined();
});
it("a saved source copy stays recognizable as a source in Library and detail without changing provenance", async () => {
  fixture.capabilities.mockResolvedValue(caps(true));
  const copy = { ...saved, provenance: "user" as const, source_url: "https://example.test/video", source_creator: "Original creator" };
  fixture.searchLibrary.mockResolvedValue({ items: [copy], total: 1, has_more: false });
  await mount(Library);
  await act(async () => listRow("Show as a list")!.props.onPress());
  expect(nodes("LibraryCard")[0].props).toMatchObject({ view: "list", origin: "Saved from the web", creator: "Original creator" });
  await act(async () => renderer!.unmount()); cache.clear(); fixture.params = { id: copy.id }; fixture.workout.mockResolvedValue(copy);
  await mount(WorkoutDetail);
  const text = nodes("Copy").flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
  expect(text).toContain("Your edits stay in this copy");
  expect(text).not.toContain("Your manually entered workout");
  expect(copy.provenance).toBe("user");
});
it("saved detail retains source metadata and prevents starting a source-only draft with no exercises", async () => {
  fixture.params = { id: "source-only" }; fixture.capabilities.mockResolvedValue(caps(false));
  fixture.workout.mockResolvedValue({ ...saved, provenance: "source", blocks: [], source_url: "https://example.test/source", source_title: "Original clip", source_creator: "Creator",
    source_thumbnail_url: "https://example.test/cover.jpg", extraction_warnings: ["No readable instructions"] });
  await mount(WorkoutDetail);
  expect(button("Start workout")).toBeUndefined();
  await act(async () => button("Recover workout instructions")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/recover-workout/[id]", params: { id: saved.id } });
  expect(nodes("SourceImage")[0].props.uri).toBe("https://example.test/cover.jpg");
  expect(nodes("Copy").flatMap(node => node.children.filter(child => typeof child === "string")).join(" ")).not.toContain("No readable instructions");
  await act(async () => button("Import diagnostics")!.props.onPress());
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
  expect(text).toContain("No set counts yet");
  expect(text).not.toContain("tracking prescription");
  expect(text).not.toContain("Review before tracking"); expect(button("Review tracking details")).toBeUndefined();
  const plan = nodes("ListRow").find(node => node.props.title === "Schedule")!;
  expect(plan.props.disabled).toBeFalsy();
  expect(plan.props.detail).toBe("Choose a date for this workout");
  await act(async () => plan.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/schedule-once", params: { workout_id: saved.id } });
  // Start is never a dead button: it asks how to track instead.
  const start = button("Start workout")!;
  expect(start.props.disabled).toBe(false);
  expect(nodes("WorkoutStartSheet")[0].props.visible).toBe(false);
  await act(async () => start.props.onPress());
  expect(fixture.start).not.toHaveBeenCalled();
  const sheet = nodes("WorkoutStartSheet")[0];
  expect(sheet.props.visible).toBe(true);
  await act(async () => sheet.props.onStart({ rounds: 4 })); await settle();
  expect(fixture.start).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id }),
    { workout_id: saved.id, workout_revision: saved.revision }, "uuid", undefined, { rounds: 4 });
  expect(fixture.push).toHaveBeenCalledWith("/training");
});

it("starts a fully specified workout immediately without asking how to track it", async () => {
  fixture.params = { id: saved.id }; fixture.capabilities.mockResolvedValue(caps(false));
  fixture.workout.mockResolvedValue(saved);
  await mount(WorkoutDetail);
  const text = nodes("Copy").flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
  expect(text).not.toContain("No set counts yet");
  await act(async () => button("Start workout")!.props.onPress()); await settle();
  expect(nodes("WorkoutStartSheet")[0].props.visible).toBe(false);
  expect(fixture.start).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id }),
    { workout_id: saved.id, workout_revision: saved.revision }, "uuid", undefined, undefined);
  expect(nodes("ListRow").find(node => node.props.title === "Schedule")!.props.detail).toBe("Choose a date for this workout");
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
  expect(nodes("StatTile")).toHaveLength(0);
  const meta = metaLine()!;
  expect(meta).toBe(`${seconds === 1200 ? "20 min" : "2m 5s"} AMRAP · 1 exercise`); expect(meta).not.toContain("25 min");
  const text = nodes("Copy").flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
  expect(text).toContain("AMRAP"); expect(text).not.toContain("Rounds not specified");
});
it("gives an empty manual workout a usable add-exercises action", async () => {
  fixture.params = { id: saved.id }; fixture.capabilities.mockResolvedValue(caps(false));
  fixture.workout.mockResolvedValue({ ...saved, blocks: [] }); await mount(WorkoutDetail);
  expect(button("Start workout")).toBeUndefined();
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

it.each([true, false])("plan previews keep explicit sets and leave unspecified sets out for AMRAP=%s", async timed => {
  const workout: Workout = { ...saved, blocks: [{ id: "flow", label: "Main", grouping: "circuit",
    ...(timed ? { execution: { mode: "amrap" as const, time_cap_seconds: 1200 } } : {}),
    exercises: [{ name: "Swings", reps_min: 10, sets: 2 }, { name: "Squat", reps_min: 10 }] }] };
  await mount(() => createElement(PrescriptionPreview, { workout }));
  const text = nodes("Copy").flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
  expect(text).toContain("2 sets"); expect(text).not.toContain("not specified");
});

it("deletes only after explicit confirmation and returns to the library", async () => {
  fixture.params = { id: saved.id };
  fixture.workout.mockResolvedValue(saved);
  fixture.deleteWorkout.mockResolvedValue(undefined);
  await mount(WorkoutDetail);
  await act(async () => header("More workout actions")!.props.onPress());
  await act(async () => nodes("ListRow").find(n => n.props.title === "Delete workout")!.props.onPress());
  expect(fixture.deleteWorkout).not.toHaveBeenCalled();
  await act(async () => button("Keep workout")!.props.onPress());
  expect(fixture.deleteWorkout).not.toHaveBeenCalled();
  await act(async () => nodes("ListRow").find(n => n.props.title === "Delete workout")!.props.onPress());
  await act(async () => button("Delete workout")!.props.onPress());
  expect(fixture.deleteWorkout).toHaveBeenCalledWith(saved.id, saved.generation);
  expect(fixture.replace).toHaveBeenCalledWith("/(tabs)/library");
});

it("puts the source video first and makes its play button actually open the video", async () => {
  const { Linking } = await import("react-native");
  fixture.params = { id: saved.id }; fixture.capabilities.mockResolvedValue(caps(false));
  fixture.workout.mockResolvedValue({ ...saved, source_url: "https://www.youtube.com/watch?v=abcdefghijk",
    source_thumbnail_url: "https://example.test/thumb.jpg", source_creator: "Coach Nani" });
  await mount(WorkoutDetail);
  const screen = nodes("Screen")[0];
  const hero = screen.findAll((n) => String(n.type) === "Pressable")[0];
  expect(hero.props.accessibilityLabel).toBe(`Open YouTube video for ${saved.title}`);
  expect(nodes("SourceImage")).toHaveLength(0);
  expect(button("Watch YouTube source")).toBeUndefined();
  expect(nodes("Copy").flatMap(n => n.children).join(" ")).toContain("Original by Coach Nani");
  await act(async () => hero.props.onPress());
  expect(Linking.openURL).toHaveBeenCalledWith("https://www.youtube.com/watch?v=abcdefghijk");
});

it("plays the source video in the app on a phone, without leaving for the original post", async () => {
  const { Linking, Platform } = await import("react-native");
  const os = Platform.OS;
  Platform.OS = "ios";
  try {
    fixture.focus = true;
    fixture.params = { id: saved.id }; fixture.capabilities.mockResolvedValue(caps(false));
    fixture.workout.mockResolvedValue({ ...saved, source_url: "https://www.youtube.com/watch?v=abcdefghijk",
      source_thumbnail_url: "https://example.test/thumb.jpg" });
    await mount(WorkoutDetail);
    const opened = vi.mocked(Linking.openURL).mock.calls.length;
    const hero = nodes("Screen")[0].findAll((n) => String(n.type) === "Pressable")[0];
    expect(hero.props.accessibilityLabel).toBe(`Play YouTube video for ${saved.title}`);
    expect(hero.props.accessibilityHint).toBe("Loads the official YouTube player. Its privacy terms apply.");
    expect(nodes("Copy").map(n => n.children.join("")).join(" ")).toContain("Playing loads the YouTube player; its privacy terms apply.");
    expect(nodes("SourcePlayerModal")).toHaveLength(0);
    await act(async () => hero.props.onPress());
    expect(nodes("SourcePlayerModal")).toHaveLength(1);
    expect(vi.mocked(Linking.openURL).mock.calls).toHaveLength(opened);
    await act(async () => nodes("SourcePlayerModal")[0].props.onClose());
    expect(nodes("SourcePlayerModal")).toHaveLength(0);
    // Leaving the screen dismisses an open player.
    await act(async () => hero.props.onPress());
    await act(async () => { fixture.focus = false; renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(WorkoutDetail))); });
    expect(nodes("SourcePlayerModal")).toHaveLength(0);
  } finally {
    Platform.OS = os;
  }
});

it("keeps a failed deletion available for retry", async () => {
  fixture.params = { id: saved.id }; fixture.workout.mockResolvedValue(saved);
  fixture.deleteWorkout.mockRejectedValue(new Error("Could not delete. Try again."));
  await mount(WorkoutDetail);
  await act(async () => header("More workout actions")!.props.onPress());
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
  await act(async () => header("More workout actions")!.props.onPress());
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

it("Library omits the count row and offers Needs info only when it has content", async () => {
  const incomplete = { ...saved, extraction_warnings: ["Rest unknown"] };
  fixture.library.mockResolvedValue([incomplete]);
  fixture.searchLibrary.mockResolvedValue({ items: [incomplete], total: 1, has_more: false });
  await mount(Library);
  expect(button("Needs info · 1")).toBeDefined();
  expect(nodes("Copy").some(node => node.props.children === "1 workout")).toBe(false);
  expect(nodes("LibrarySearch")).toHaveLength(0);
});

it("Library long-press starts selecting that workout, and Select all covers every loaded workout", async () => {
  const second = { ...saved, id: "copy-2", title: "Second workout" };
  fixture.searchLibrary.mockResolvedValue({ items: [saved, second], total: 2, has_more: false });
  await mount(Library);
  expect(button("Add selected to collection")).toBeUndefined();
  await act(async () => libraryCard(second.title)!.props.onLongPress());
  expect(libraryCard(second.title)!.props.selected).toBe(true); expect(libraryCard(saved.title)!.props.selected).toBe(false);
  expect(libraryCard(second.title)!.props.onLongPress).toBeUndefined();
  await act(async () => button("Select all")!.props.onPress());
  expect(nodes("LibraryCard").every(node => node.props.selected)).toBe(true);
  await act(async () => button("Clear selection")!.props.onPress());
  expect(nodes("LibraryCard").some(node => node.props.selected)).toBe(false);
  expect(button("Add selected to collection")!.props.disabled).toBe(true);
  await act(async () => button("Done")!.props.onPress());
  expect(libraryCard(saved.title)!.props.selected).toBeUndefined(); expect(button("Add selected to collection")).toBeUndefined();
  await act(async () => libraryCard(saved.title)!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/workout/[id]", params: { id: saved.id } });
});
it("Library loads the next page as the list nears its end", async () => {
  const second = { ...saved, id: "copy-2", title: "Second workout" };
  fixture.searchLibrary.mockResolvedValueOnce({ items: [saved], total: 2, has_more: true, next_cursor: "next" })
    .mockResolvedValueOnce({ items: [second], total: 2, has_more: false, next_cursor: null });
  await mount(Library);
  expect(nodes("LibraryCard")).toHaveLength(1);
  await act(async () => nodes("FlatList")[0].props.onEndReached()); await settle();
  expect(fixture.searchLibrary.mock.calls.at(-1)![1]).toBe("next");
  expect(nodes("LibraryCard")).toHaveLength(2);
  await act(async () => nodes("FlatList")[0].props.onEndReached()); await settle();
  expect(fixture.searchLibrary).toHaveBeenCalledTimes(2);
});
it("Library remembers grid or list for this account and covers collections from loaded workouts", async () => {
  fixture.collections.mockResolvedValue([{ id: "gym", title: "Gym days", workout_count: 1 }]);
  fixture.searchLibrary.mockResolvedValue({ items: [{ ...saved, source_thumbnail_url: "https://example.test/cover.jpg",
    organization: { ...emptyOrganization(), collection_ids: ["gym"] } }], total: 1, has_more: false });
  await mount(Library);
  expect(button("Collections")).toBeDefined();
  expect(nodes("FlatList")[0].props.numColumns).toBe(2);
  await act(async () => listRow("Show as a list")!.props.onPress()); await settle();
  expect(nodes("FlatList")[0].props.numColumns).toBe(1);
  expect(fixture.map.get("hafa-workouts:v1:owner:library-view")).toBe("list");
  // A fresh launch reads the saved choice from this account's device storage.
  await act(async () => renderer!.unmount()); cache.clear(); await mount(Library);
  expect(libraryCard(saved.title)!.props.view).toBe("list");
});
it("surfaces collection filters and management directly beside library search", async () => {
  fixture.collections.mockResolvedValue([{ id: "gym", title: "Gym days", workout_count: 2 }]);
  fixture.searchLibrary.mockResolvedValue({ items: [saved], total: 1, has_more: false });
  await mount(Library);
  expect(listRow("Manage collections")).toBeDefined();
  await act(async () => button("Collections")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith("/collections");
  await act(async () => filterChoice("Gym days").props.onPress()); await settle();
  expect(fixture.searchLibrary.mock.calls.at(-1)![0].collection_id).toBe("gym");
  await act(async () => nodes("Chip").find(node => node.props.label === "Up to 15 min")!.props.onPress()); await settle();
  expect(fixture.searchLibrary.mock.calls.at(-1)![0]).toMatchObject({ collection_id: "gym", max_minutes: 15 });
  expect(nodes("Button").some(n => n.props.title === "Up to 15 min · Gym days · Clear")).toBe(true);
});
it("Needs info finds matches after the first library page", async () => {
  const incomplete = { ...saved, id: "needs", title: "Needs timing", extraction_warnings: ["Rest unknown"] };
  fixture.library.mockResolvedValue([saved, incomplete]);
  fixture.searchLibrary.mockImplementation(async (_filters, cursor) => cursor ? { items: [incomplete], total: 2, has_more: false, next_cursor: null } : { items: [saved], total: 2, has_more: true, next_cursor: "next" });
  await mount(Library);
  await act(async () => button("Needs info · 1")!.props.onPress()); await settle();
  expect(nodes("LibraryCard").map(n => n.props.title)).toEqual(["Needs timing"]);
});

const gym = { id: "gym", title: "Gym days", revision: 3, workout_count: 1 };
const sheet = (title: string) => nodes("Sheet").find(node => node.props.title === title)!;
it("a collection opens its own workouts and renames from its options", async () => {
  fixture.params = { id: "gym" }; fixture.collections.mockResolvedValue([gym]);
  fixture.searchLibrary.mockResolvedValue({ items: [saved], total: 1, has_more: false });
  fixture.renameCollection.mockRejectedValueOnce(new ApiError("Collection changed; refresh before saving", 409)).mockResolvedValue({});
  await mount(CollectionDetail);
  expect(nodes("Screen")[0].props.title).toBe("Gym days");
  expect(fixture.searchLibrary.mock.calls.at(-1)![0]).toEqual({ collection_id: "gym" });
  expect(nodes("LibraryCard")).toHaveLength(1);
  await act(async () => nodes("Screen")[0].props.action.props.onPress());
  await act(async () => listRow("Rename collection")!.props.onPress());
  expect(sheet("Rename collection").props.visible).toBe(true);
  await act(async () => nodes("Field").find(node => node.props.label === "Collection name")!.props.onChange("Leg days"));
  await act(async () => button("Save name")!.props.onPress()); await settle();
  expect(sheet("Rename collection").props.visible).toBe(true);
  expect(nodes("Notice").some(node => JSON.stringify(node.props).includes("Collection changed"))).toBe(true);
  await act(async () => button("Save name")!.props.onPress()); await settle();
  expect(fixture.renameCollection).toHaveBeenLastCalledWith("gym", "Leg days", 3, 1);
  expect(sheet("Rename collection").props.visible).toBe(false);
});
it("removing a collection confirms first, keeps its workouts and goes back", async () => {
  fixture.params = { id: "gym" }; fixture.collections.mockResolvedValue([gym]);
  fixture.searchLibrary.mockResolvedValue({ items: [saved], total: 1, has_more: false });
  fixture.removeCollection.mockResolvedValue(undefined);
  await mount(CollectionDetail);
  await act(async () => listRow("Remove collection")!.props.onPress());
  expect(fixture.removeCollection).not.toHaveBeenCalled();
  expect(sheet("Remove collection?").props.visible).toBe(true);
  const searches = fixture.searchLibrary.mock.calls.length;
  fixture.collections.mockResolvedValue([]);
  await act(async () => button("Remove collection")!.props.onPress()); await settle();
  expect(fixture.removeCollection).toHaveBeenCalledExactlyOnceWith("gym", 3, 1);
  expect(fixture.back).toHaveBeenCalled();
  expect(fixture.searchLibrary.mock.calls.length).toBe(searches); // The deleted collection is never searched again.
  expect(fixture.collections.mock.calls.length).toBeGreaterThan(1); // The library's collection list refreshes.
});
it("a removed collection explains itself instead of loading", async () => {
  fixture.params = { id: "gone" }; fixture.collections.mockResolvedValue([gym]);
  await mount(CollectionDetail);
  expect(nodes("Empty")[0].props.title).toBe("This collection was removed");
  expect(fixture.searchLibrary).not.toHaveBeenCalled();
  expect(nodes("Screen")[0].props.action).toBeUndefined();
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
  await mount(Library); await act(async () => listRow("Select workouts")!.props.onPress());
  await act(async () => { libraryCard(saved.title)!.props.onPress(); libraryCard(second.title)!.props.onPress(); });
  await act(async () => button("Add selected to collection")!.props.onPress());
  const press = button("Add to collection")!.props.onPress;
  await act(async () => { press(); press(); }); await settle();
  expect(fixture.saveOrganization).toHaveBeenCalledTimes(2);
  expect(libraryCard(saved.title)!.props.selected).toBe(false); expect(libraryCard(second.title)!.props.selected).toBe(true);
  await act(async () => button("Retry remaining workouts")!.props.onPress()); await settle();
  expect(fixture.saveOrganization.mock.calls.map(([id]) => id)).toEqual([saved.id, second.id, second.id]);
  expect(fixture.saveOrganization.mock.calls[2][1]).toEqual({ expected_revision: 3, collection_ids: ["existing", "gym"] });
  expect(libraryCard(saved.title)!.props.selected).toBeUndefined();
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
  const press = row("Favorite workout")!.props.onPress;
  await act(async () => { press(); press(); }); expect(fixture.organization).toHaveBeenCalledTimes(1);
  await act(async () => resolve(latest)); await settle();
  expect(fixture.saveOrganization).toHaveBeenCalledExactlyOnceWith(saved.id, { expected_revision: 7, favorite: true }, 1);
  expect(cache.getQueryData<Workout>(["owner", "workout", saved.id, 1])?.organization).toEqual({ ...latest, revision: 8, favorite: true });
  expect(row("Remove favorite")).toBeDefined(); expect(row("Organize workout")).toBeDefined();
});
it("a retired account cannot continue a held bulk add", async () => {
  fixture.collections.mockResolvedValue([{ id: "gym", title: "Gym", workout_count: 0 }]);
  fixture.searchLibrary.mockResolvedValue({ items: [saved], total: 1, has_more: false });
  let resolve!: (organization: ReturnType<typeof emptyOrganization>) => void;
  fixture.organization.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount(Library); await act(async () => listRow("Select workouts")!.props.onPress());
  await act(async () => libraryCard(saved.title)!.props.onPress()); await act(async () => button("Add selected to collection")!.props.onPress());
  await act(async () => button("Add to collection")!.props.onPress()); fixture.current = false;
  await act(async () => resolve(emptyOrganization())); await settle();
  expect(fixture.saveOrganization).not.toHaveBeenCalled();
});

it("a direct favorite stops before writing when the account retires during its metadata read", async () => {
  fixture.params = { id: saved.id }; fixture.capabilities.mockResolvedValue(caps(false));
  fixture.workout.mockResolvedValue({ ...saved, organization: emptyOrganization() });
  let resolve!: (organization: ReturnType<typeof emptyOrganization>) => void;
  fixture.organization.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount(WorkoutDetail); await act(async () => row("Favorite workout")!.props.onPress());
  fixture.current = false; await act(async () => resolve(emptyOrganization())); await settle();
  expect(fixture.saveOrganization).not.toHaveBeenCalled();
  expect(cache.getQueryData<Workout>(["owner", "workout", saved.id, 1])?.organization?.favorite).toBe(false);
});

it("a new enrollment resets private bulk selection and fences an old in-flight result", async () => {
  fixture.collections.mockResolvedValue([{ id: "gym", title: "Gym", workout_count: 0 }]);
  fixture.searchLibrary.mockResolvedValue({ items: [saved], total: 1, has_more: false });
  let resolve!: (organization: ReturnType<typeof emptyOrganization>) => void;
  fixture.organization.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount(Library); await act(async () => listRow("Select workouts")!.props.onPress());
  await act(async () => libraryCard(saved.title)!.props.onPress()); await act(async () => button("Add selected to collection")!.props.onPress());
  await act(async () => button("Add to collection")!.props.onPress());
  fixture.generation = 2; fixture.searchLibrary.mockResolvedValue({ items: [], total: 0, has_more: false });
  await act(async () => renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(Library)))); await settle();
  await act(async () => resolve(emptyOrganization())); await settle();
  expect(fixture.saveOrganization).not.toHaveBeenCalled(); expect(button("Add selected to collection")).toBeUndefined();
  expect(nodes("Sheet").find(node => node.props.title === "Add workouts to a collection")!.props.visible).toBe(false);
});

it("freezes a pending bulk target and selection despite captured controls and changing filters", async () => {
  const second = { ...saved, id: "second", title: "Second workout" };
  fixture.collections.mockResolvedValue([{ id: "gym", title: "Gym", workout_count: 0 }, { id: "home", title: "Home", workout_count: 0 }]);
  fixture.searchLibrary.mockResolvedValue({ items: [saved, second], total: 2, has_more: false });
  let resolve!: (organization: ReturnType<typeof emptyOrganization>) => void;
  fixture.organization.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(emptyOrganization());
  fixture.saveOrganization.mockImplementation(async (_id, body) => ({ ...emptyOrganization(), revision: 1, collection_ids: body.collection_ids }));
  await mount(Library); await act(async () => listRow("Select workouts")!.props.onPress());
  const selectSecond = libraryCard(second.title)!.props.onPress;
  await act(async () => libraryCard(saved.title)!.props.onPress()); await act(async () => button("Add selected to collection")!.props.onPress());
  const bulkSheet = nodes("Sheet").find(node => node.props.title === "Add workouts to a collection")!;
  const chooseHome = bulkSheet.findAll(node => String(node.type) === "Choice" && node.props.label === "Home")[0].props.onPress;
  const doneSelecting = button("Done")!.props.onPress;
  await act(async () => button("Add to collection")!.props.onPress());
  await act(async () => { selectSecond(); chooseHome(); doneSelecting(); });
  await act(async () => filterChoice("Home").props.onPress()); await settle();
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
  await mount(Library); await act(async () => listRow("Select workouts")!.props.onPress());
  await act(async () => libraryCard(saved.title)!.props.onPress()); await act(async () => button("Add selected to collection")!.props.onPress());
  await act(async () => button("Add to collection")!.props.onPress()); await settle();
  expect(libraryCard(saved.title)!.props.selected).toBe(true);
  expect(fixture.saveOrganization).toHaveBeenCalledTimes(1); expect(fixture.organization).toHaveBeenCalledTimes(1);
  expect(button("Retry remaining workouts")).toBeDefined();
  await act(async () => button("Retry remaining workouts")!.props.onPress()); await settle();
  expect(fixture.saveOrganization.mock.calls[1]).toEqual([saved.id, { expected_revision: 2, collection_ids: ["concurrent", "gym"] }, 1]);
});

const collectionField = (label: string) => nodes("Field").find(node => node.props.label === label)!;
async function replaceCollectionAccount() {
  fixture.owner = "replacement-owner"; fixture.generation = 2;
  await act(async () => { renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(Collections))); });
  await settle();
}
it.each(["resolve", "reject"])("retired collection create %s cannot clear or unlock the new account draft", async result => {
  let releaseOld!: () => void, releaseNew!: () => void;
  fixture.createCollection.mockImplementationOnce(() => new Promise((resolve, reject) => {
    releaseOld = () => result === "resolve" ? resolve({}) : reject(Error("retired create failed"));
  })).mockImplementationOnce(() => new Promise(resolve => { releaseNew = () => resolve({}); }));
  await mount(Collections);
  await act(async () => { collectionField("New collection name").props.onChange("Old account name"); });
  const oldCreate = button("Create collection")!.props.onPress;
  await act(async () => { oldCreate(); oldCreate(); }); await settle();
  expect(fixture.createCollection).toHaveBeenCalledTimes(1);
  await replaceCollectionAccount();
  await act(async () => { collectionField("New collection name").props.onChange("New account name"); });
  await act(async () => { button("Create collection")!.props.onPress(); }); await settle();
  const invalidated = vi.spyOn(cache, "invalidateQueries");
  await act(async () => { releaseOld(); }); await settle();
  expect(collectionField("New collection name").props.value).toBe("New account name");
  expect(button("Create collection")!.props.busy).toBe(true);
  expect(invalidated).not.toHaveBeenCalled();
  expect(nodes("Notice").some(node => JSON.stringify(node.props).includes("retired create failed"))).toBe(false);
  await act(async () => { oldCreate(); });
  expect(fixture.createCollection).toHaveBeenCalledTimes(2);
  await act(async () => { releaseNew(); }); await settle();
  expect(collectionField("New collection name").props.value).toBe("");
  expect(button("Create collection")!.props.busy).toBe(false);
});
it("retired collection rename completion cannot update the replacement editor or unlock its save", async () => {
  fixture.collections.mockResolvedValue([{ id: "same-id", title: "Collection", revision: 1, workout_count: 2 }]);
  let releaseOld!: () => void, releaseNew!: () => void;
  fixture.renameCollection.mockImplementationOnce(() => new Promise(resolve => { releaseOld = () => resolve({}); }))
    .mockImplementationOnce(() => new Promise(resolve => { releaseNew = () => resolve({}); }));
  await mount(Collections);
  await act(async () => { collectionField("Collection name: Collection").props.onChange("Old renamed title"); });
  const oldSave = button("Save collection name")!.props.onPress;
  await act(async () => { oldSave(); oldSave(); }); await settle();
  expect(fixture.renameCollection).toHaveBeenCalledTimes(1);
  await replaceCollectionAccount();
  await act(async () => { collectionField("Collection name: Collection").props.onChange("New renamed title"); });
  await act(async () => { button("Save collection name")!.props.onPress(); }); await settle();
  await act(async () => { releaseOld(); }); await settle();
  expect(collectionField("Collection name: Collection").props.value).toBe("New renamed title");
  expect(button("Save collection name")!.props.busy).toBe(true);
  await act(async () => { oldSave(); });
  expect(fixture.renameCollection).toHaveBeenCalledTimes(2);
  await act(async () => { releaseNew(); }); await settle();
  expect(collectionField("Collection name: New renamed title").props.value).toBe("New renamed title");
});
it("retired collection remove and field callbacks cannot act for a replacement account", async () => {
  fixture.collections.mockResolvedValue([{ id: "same-id", title: "Collection", revision: 1, workout_count: 2 }]);
  await mount(Collections);
  const oldField = collectionField("Collection name: Collection").props.onChange;
  await act(async () => { button("Remove collection")!.props.onPress(); });
  const oldRemove = button("Remove this collection")!.props.onPress;
  await replaceCollectionAccount();
  await act(async () => { oldField("Retired edit"); oldRemove(); }); await settle();
  expect(collectionField("Collection name: Collection").props.value).toBe("Collection");
  expect(button("Remove this collection")).toBeUndefined();
  expect(fixture.removeCollection).not.toHaveBeenCalled();
});

it("puts the workout before one accurate review summary and keeps raw diagnostics optional", async () => {
  fixture.params = { id: "job" }; fixture.capabilities.mockResolvedValue(caps(true));
  const job = importJob("url", "incomplete");
  const warning = "Unsupported reps_min removed from Squat.";
  const coverage = "Transcript was unavailable; caption was read.";
  const warnings = [warning, warning, "Unsupported reps_max removed from Squat."];
  fixture.importJob.mockResolvedValue({ ...job, result: { ...job.result, warnings,
    source: { ...job.result.source, coverage_notes: [coverage, warning] } } });
  await mount(ImportReview);
  const collapsed = JSON.stringify(renderer!.toJSON());
  expect(collapsed).not.toContain(warning); expect(collapsed).not.toContain(coverage);
  expect(collapsed).not.toContain("not in the source");
  expect(nodes("Notice").filter(n => n.children.join("").includes("confirm all workout details"))).toHaveLength(1);
  expect(collapsed.indexOf(job.result.workout.title)).toBeLessThan(collapsed.indexOf("confirm all workout details"));
  expect(button("Correct workout details")).toBeDefined();
  expect(choice("Share to Discover")!.props.disabled).toBe(true);
  await act(async () => button("Source details")!.props.onPress());
  const expanded = JSON.stringify(renderer!.toJSON());
  expect(expanded).toContain("Import diagnostics"); expect(expanded).toContain(coverage);
  expect(nodes("Copy").filter(n => n.children.join("") === warning)).toHaveLength(1);
  expect(warnings).toEqual([warning, warning, "Unsupported reps_max removed from Squat."]);
  await act(async () => button("Hide source details")!.props.onPress());
  expect(JSON.stringify(renderer!.toJSON())).not.toContain(warning);
});

it.each([
  ["workouts_ai_budget_unavailable", "couldn’t finish checking", "usage limit"],
  ["workouts_ai_budget_exceeded", "temporarily paused", "usage limit"],
])("explains %s once without exposing machine codes or blaming the caption", async (code, expected, other) => {
  fixture.params = { id: "job" }; fixture.capabilities.mockResolvedValue(caps(false));
  const job = importJob("text", "incomplete");
  fixture.importJob.mockResolvedValue({ ...job, result: { ...job.result, error_code: code,
    warnings: [code, "Source extraction could not finish"] } });
  await mount(ImportReview);
  let view = JSON.stringify(renderer!.toJSON());
  expect(view).toContain(expected); expect(view).not.toContain(other); expect(view).not.toContain(code);
  expect(view).not.toContain("not in the source"); expect(view).not.toContain("Source extraction could not finish");
  expect(nodes("Notice").filter(n => n.children.join("").includes(expected))).toHaveLength(1);
  await act(async () => button("Source details")!.props.onPress());
  view = JSON.stringify(renderer!.toJSON());
  expect(view).toContain(`Import status`); expect(view).toContain(code);
});

it.each([undefined, "workouts_ai_budget_unavailable", "workouts_ai_budget_exceeded"])("keeps one actionable review summary for an already saved draft (%s)", async (code) => {
  fixture.params = { id: "job" }; fixture.capabilities.mockResolvedValue(caps(false));
  const job = importJob("url", "incomplete");
  fixture.importJob.mockResolvedValue({ ...job, accepted_workout_id: "saved", result: { ...job.result,
    error_code: code, warnings: ["Unsupported reps_min removed from Squat."] } });
  await mount(ImportReview);
  const view = JSON.stringify(renderer!.toJSON());
  expect(view).toContain("Open the saved workout to check or edit those details.");
  expect(view).not.toContain("before saving");
  expect(nodes("Notice").filter(n => n.children.join("").includes("Open the saved workout"))).toHaveLength(1);
  expect(button("Open saved workout")).toBeDefined(); expect(button("Check details")).toBeDefined();
  expect(button("Save workout")).toBeUndefined();
  await act(async () => button("Check details")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/edit-workout/[id]", params: { id: "saved", review: "1" } });
});

it("keeps saved workout instructions ahead of optional diagnostics without losing correction or source recovery", async () => {
  fixture.params = { id: saved.id }; fixture.capabilities.mockResolvedValue(caps(false));
  const warning = "Unsupported reps_min removed from Goblet squat.";
  const warnings = [warning, warning, "Unsupported reps_max removed from Goblet squat."];
  fixture.workout.mockResolvedValue({ ...saved, instructions: ["Repeat this circuit with controlled movements."],
    source_url: "https://example.test/original", extraction_warnings: warnings });
  await mount(WorkoutDetail);
  const renderedText = () => nodes("Copy").flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
  const collapsed = renderedText();
  expect(collapsed).not.toContain(warning);
  expect(collapsed.indexOf("Repeat this circuit")).toBeLessThan(collapsed.indexOf("Review workout details"));
  expect(collapsed.indexOf("Goblet squat")).toBeLessThan(collapsed.indexOf("Review workout details"));
  expect(nodes("Copy").filter(node => node.children.join("").includes("Some workout details need checking"))).toHaveLength(1);
  await act(async () => button("Check details")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/edit-workout/[id]", params: { id: saved.id, review: "1" } });
  await act(async () => button("Recover from caption or source")!.props.onPress());
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/recover-workout/[id]", params: { id: saved.id } });
  await act(async () => button("Import diagnostics")!.props.onPress());
  expect(nodes("Copy").filter(node => node.children.join("") === warning)).toHaveLength(1);
  expect(warnings).toEqual([warning, warning, "Unsupported reps_max removed from Goblet squat."]);
  await act(async () => button("Hide import diagnostics")!.props.onPress());
  expect(renderedText()).not.toContain(warning);
});

it.each([undefined, false, true])("gates the owner cover editor on actual server cover readiness %s", async ready => {
  fixture.params = { id: saved.id }; fixture.workout.mockResolvedValue({ ...saved, cover_origin: "user", source_thumbnail_url: "https://example.test/user.jpg",
    source_title: "Original source title", source_creator: "Original creator" });
  fixture.capabilities.mockResolvedValue({ ...caps(false), cover_upload: ready });
  await mount(WorkoutDetail);
  const change = row("Change cover photo");
  expect(!!change).toBe(ready === true);
  expect(nodes("SourceImage")[0].props.label).toBe("Custom workout cover photo");
  expect(nodes("Copy").flatMap(node => node.children).join(" ")).toContain("Original creator");
  if (change) {
    await act(async () => change.props.onPress());
    expect(fixture.push).toHaveBeenCalledWith({ pathname: "/workout-cover/[id]", params: { id: saved.id } });
  }
});

it("Discover has one text-link row and no inline search or count", async () => {
  fixture.capabilities.mockResolvedValue(caps(true)); fixture.discover.mockResolvedValue(page());
  await mount(Discover);
  expect(nodes("Field")).toHaveLength(0);
  expect(button("Filter")).toBeDefined(); expect(button("Surprise me")).toBeDefined();
  expect(button("Share yours")).toBeDefined();
  expect(nodes("Copy").some(n => n.children.join("") === "All workouts")).toBe(true);
});

it("Library keeps cached cards and offers an explicit retry when refreshing workouts fails", async () => {
  fixture.capabilities.mockResolvedValue(caps(false));
  fixture.searchLibrary.mockResolvedValue({ items: [saved], total: 1, has_more: false });
  await mount(Library);
  fixture.searchLibrary.mockRejectedValueOnce(new ApiError("Offline", 503));
  await act(async () => nodes("Screen")[0].props.onRefresh()); await settle();
  expect(nodes("LibraryCard")).toHaveLength(1);
  expect(button("Retry loading workouts")).toBeDefined();
  expect(nodes("Notice").some(n => String(n.props.children).includes("Showing your saved workouts"))).toBe(true);
  await act(async () => button("Retry loading workouts")!.props.onPress()); await settle();
  expect(button("Retry loading workouts")).toBeUndefined();
  expect(nodes("LibraryCard")).toHaveLength(1);
});

it("saving a Discover photo is serialized and refreshes the library", async () => {
  fixture.capabilities.mockResolvedValue(caps(true)); fixture.discover.mockResolvedValue(page());
  let finish!: (value: Workout) => void;
  fixture.saveDiscovered.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(Discover);
  const save = nodes("DiscoverGridCard")[0].props.onSave;
  await act(async () => { save(); save(); });
  expect(fixture.saveDiscovered).toHaveBeenCalledTimes(1);
  expect(fixture.saveDiscovered).toHaveBeenCalledWith(card.id, 1);
  await act(async () => finish(saved)); await settle();
  expect(fixture.toast).toHaveBeenCalledWith("Saved to your library");
});
