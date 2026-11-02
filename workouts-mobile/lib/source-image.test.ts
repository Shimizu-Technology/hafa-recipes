import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Image: "Image", Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", View: "View",
  useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1 }),
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Copy: "Copy", useColors: () => ({ background: "#000" }) }));
vi.mock("../components/ui", () => ({ Button: "Button", Copy: "Copy", useColors: () => ({ background: "#000" }) }));

const { SourceImage } = await import("../components/source-image");

async function failImage(props: Record<string, unknown>) {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(SourceImage, { uri: "https://example.test/cover.jpg", label: "Cover", cover: true, ...props })); });
  const image = renderer.root.findAll((node) => String(node.type) === "Image")[0];
  await act(async () => image.props.onError());
  return renderer;
}

it("collapses a failed cover when the caller asks for no fallback", async () => {
  const onFailed = vi.fn();
  const renderer = await failImage({ fallback: null, onFailed });
  expect(renderer.toJSON()).toBeNull();
  expect(onFailed).toHaveBeenCalledTimes(1);
});

it("explains a failed source image when no fallback is given", async () => {
  const renderer = await failImage({});
  const copy = renderer.root.findAll((node) => String(node.type) === "Copy");
  expect(copy.map((node) => node.props.children)).toEqual(["This image is unavailable. You can still check the original source."]);
});
