import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Workout } from "./models";
const f = vi.hoisted(() => ({ owner: "owner-a", generation: 1, enrolled: true, push: vi.fn(), library: vi.fn(), capabilities: vi.fn(), discover: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-router", () => ({ Stack: { Screen: "NativeHeader" }, router: { push: f.push } }));
vi.mock("@/components/ui", () => ({ Copy: "Copy", Empty: "Empty", Field: "Field", ListGroup: "ListGroup", ListRow: "ListRow", Notice: "Notice", Screen: "Screen" }));
vi.mock("@/lib/context", () => ({ useTraining: () => ({ owner: f.owner, enrollment: { enrolled: f.enrolled, generation: f.generation }, api: { library: f.library, capabilities: f.capabilities, discover: f.discover } }) }));
vi.mock("@/lib/use-focus-refresh", () => ({ useFocusRefresh: () => ({ refreshing: false, onRefresh() {} }) }));
import Search from "../app/(tabs)/search/index";
let view: ReactTestRenderer, cache: QueryClient;
const workouts = [
  { id: "a", title: "Morning strength", equipment_required: ["dumbbell"], blocks: [{ exercises: [{ name: "Goblet squat" }] }] },
  { id: "b", title: "Easy run", equipment_required: [], blocks: [] },
] as Workout[];
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  f.owner = "owner-a"; f.generation = 1; f.enrolled = true;
  vi.clearAllMocks(); f.library.mockResolvedValue(workouts);
  f.capabilities.mockResolvedValue({ discover: false }); f.discover.mockResolvedValue({ items: [{ id: "public", title: "Shared strength", contributor: { display_name: "Kai" } }] });
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
});
afterEach(() => { act(() => view?.unmount()); cache.clear(); });
const screen = () => createElement(QueryClientProvider, { client: cache }, createElement(Search));
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}
it("searches titles, exercises and equipment with a native search bar, and opens saved detail", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => { view = create(screen()); });
  await settle();
  const header = () => view.root.findByType("NativeHeader" as never).props.options.headerSearchBarOptions;
  expect(header()).toMatchObject({ autoFocus: true, placeholder: "Search 2 workouts" });
  for (const text of ["morning", "goblet", "dumbbell"]) {
    act(() => header().onChangeText({ nativeEvent: { text } }));
    const rows = view.root.findAllByType("ListRow" as never);
    expect(rows.map(row => row.props.title)).toEqual(["Morning strength"]);
  }
  act(() => view.root.findByType("ListRow" as never).props.onPress());
  expect(f.push).toHaveBeenCalledWith({ pathname: "/workout/[id]", params: { id: "a" } });
  act(() => header().onChangeText({ nativeEvent: { text: "missing" } }));
  expect(view.root.findByType("Empty" as never).props.title).toBe("No matching workouts");
  act(() => header().onCancelButtonPress());
  expect(view.root.findAllByType("ListRow" as never)).toHaveLength(4);
  f.owner = "owner-b"; f.generation = 2;
  act(() => view.update(screen()));
  await settle();
  expect(cache.getQueryData(["owner-b", "library", "search", 2])).toEqual(workouts);
  f.enrolled = false;
  act(() => view.update(screen()));
  expect(f.library).toHaveBeenCalledTimes(2);
  expect(view.root.findByType("ListRow" as never).props.title).toBe("Set up your library");
});


it("refetches mounted Search after a Library prefix invalidation and removes deleted results", async () => {
  await act(() => { view = create(screen()); }); await settle();
  const header = () => view.root.findByType("NativeHeader" as never).props.options.headerSearchBarOptions;
  act(() => header().onChangeText({ nativeEvent: { text: "goblet" } }));
  expect(view.root.findAllByType("ListRow" as never).map(row => row.props.title)).toEqual(["Morning strength"]);
  f.library.mockResolvedValue([workouts[1]]);
  await act(async () => { await cache.invalidateQueries({ queryKey: [f.owner, "library"] }); }); await settle();
  expect(f.library).toHaveBeenCalledTimes(2);
  expect(view.root.findAllByType("ListRow" as never)).toHaveLength(0);
  expect(view.root.findByType("Empty" as never).props.title).toBe("No matching workouts");
  act(() => header().onCancelButtonPress());
  expect(cache.getQueryData([f.owner, "library", "search", f.generation])).toEqual([workouts[1]]);
  expect(view.root.findAllByType("ListRow" as never).map(row => row.props.title)).toEqual(["Dumbbells", "Bodyweight", "Full body", "Squat"]);
});

it("shows suggestions when empty and searches Discover with the settled query", async () => {
  f.capabilities.mockResolvedValue({ discover: true });
  await act(() => { view = create(screen()); }); await settle();
  expect(view.root.findAllByType("ListRow" as never).map(row => row.props.title)).toEqual(["Dumbbells", "Bodyweight", "Full body", "Squat"]);
  act(() => view.root.findAllByType("ListRow" as never)[0].props.onPress());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); }); await settle();
  expect(f.discover).toHaveBeenLastCalledWith({ q: "Dumbbells" }, 0, expect.any(AbortSignal));
  const shared = view.root.findAllByType("ListRow" as never).find(row => row.props.title === "Shared strength")!;
  act(() => shared.props.onPress());
  expect(f.push).toHaveBeenLastCalledWith({ pathname: "/discover/[id]", params: { id: "public" } });
});

it("offers all 21 Discover matches in the paginated feed with the settled query preserved", async () => {
  const matches = Array.from({ length: 21 }, (_, i) => ({ id: `shared-${i}`, title: `Strength ${i + 1}`, contributor: { display_name: "Kai" } }));
  f.capabilities.mockResolvedValue({ discover: true });
  f.discover.mockResolvedValue({ items: matches.slice(0, 20), total: 21, has_more: true, next_offset: 20 });
  await act(() => { view = create(screen()); }); await settle();
  act(() => view.root.findByType("NativeHeader" as never).props.options.headerSearchBarOptions.onChangeText({ nativeEvent: { text: " strength " } }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); }); await settle();
  const rows = view.root.findAllByType("ListRow" as never);
  expect(rows.filter(row => row.props.title.startsWith("Strength "))).toHaveLength(20);
  act(() => rows.find(row => row.props.title === "See all in Discover")!.props.onPress());
  expect(f.push).toHaveBeenLastCalledWith({ pathname: "/(tabs)/discover", params: { q: "strength" } });
});
