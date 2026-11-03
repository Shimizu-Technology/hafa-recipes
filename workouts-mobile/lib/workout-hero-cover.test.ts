vi.mock("@/components/workout-art", () => ({ WorkoutArt: "WorkoutArt" }));
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Image: "Image", Linking: { openURL: vi.fn() }, Platform: { OS: "ios" }, View: "View" }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({ useFocusEffect: () => {} }));
vi.mock("@/components/ui", () => ({ Copy: "Copy", IconButton: "IconButton", Notice: "Notice", Row: "Row", useColors: () => ({}) }));
vi.mock("@/components/design/press", () => ({ animatedPressableComponent: () => "Pressable", usePressScale: () => ({}) }));
vi.mock("@/components/source-image", () => ({ SourceImage: "SourceImage" }));
vi.mock("@/lib/source-playback", () => ({ embeddedSourcesEnabled: () => false, sourcePlayer: () => null, sourceURL: () => null }));
vi.mock("../components/source-player", () => ({ SourcePlayerModal: "SourcePlayerModal" }));

const { WorkoutHero } = await import("../components/workout-hero");

const source = (cover: string | null) => ({ title: "Run", source_title: null, source_creator: null, source_thumbnail_url: cover, source_url: null, cover_origin: "user" as const });

it("retries a cover that failed once it is removed and restored", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let renderer!: ReactTestRenderer;
  const covers = () => renderer.root.findAll(node => String(node.type) === "SourceImage");
  await act(async () => { renderer = create(createElement(WorkoutHero, { source: source("https://example.test/a.jpg") })); });
  await act(async () => covers()[0].props.onFailed());
  expect(covers()).toHaveLength(0);
  await act(async () => renderer.update(createElement(WorkoutHero, { source: source(null) })));
  await act(async () => renderer.update(createElement(WorkoutHero, { source: source("https://example.test/a.jpg") })));
  expect(covers()).toHaveLength(1);
  await act(async () => renderer.unmount());
});
