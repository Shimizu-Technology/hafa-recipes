import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import type { Workout } from "./models";
const f = vi.hoisted(() => ({ owner: "owner-a", generation: 1, enrolled: true, options: null as any, push: vi.fn(), library: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-router", () => ({ Stack: { Screen: "NativeHeader" }, router: { push: f.push } }));
vi.mock("@/components/ui", () => ({ Copy: "Copy", Empty: "Empty", Field: "Field", ListGroup: "ListGroup", ListRow: "ListRow", Notice: "Notice", Screen: "Screen" }));
vi.mock("@/lib/context", () => ({ useTraining: () => ({ owner: f.owner, enrollment: { enrolled: f.enrolled, generation: f.generation }, api: { library: f.library } }) }));
vi.mock("@/lib/use-focus-refresh", () => ({ useFocusRefresh: () => ({ refreshing: false, onRefresh() {} }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: any) => { f.options = options; return { data: [
  { id: "a", title: "Morning strength", equipment_required: ["dumbbell"], blocks: [{ exercises: [{ name: "Goblet squat" }] }] },
  { id: "b", title: "Easy run", equipment_required: [], blocks: [] },
] as Workout[], isPending: false }; } }));
import Search from "../app/(tabs)/search/index";
let view: ReactTestRenderer;
afterEach(() => { act(() => view?.unmount()); });
it("searches titles, exercises and equipment with a native search bar, and opens saved detail", () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => { view = create(createElement(Search)); });
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
  expect(view.root.findAllByType("ListRow" as never)).toHaveLength(2);
  f.owner = "owner-b"; f.generation = 2;
  act(() => view.update(createElement(Search)));
  expect(f.options.queryKey).toEqual(["owner-b", "search-library", 2]);
  f.enrolled = false;
  act(() => view.update(createElement(Search)));
  expect(f.options.enabled).toBe(false);
  expect(view.root.findByType("ListRow" as never).props.title).toBe("Set up your library");
});
