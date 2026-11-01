import { expect, it, vi } from "vitest";
vi.mock("expo-router/unstable-native-tabs", () => ({ NativeTabs: Object.assign(() => null, { Trigger: Object.assign(() => null, { Label: () => null, Icon: () => null }) }) }));
vi.mock("@/components/ui", () => ({ useColors: () => ({ action: "cocoa", background: "white" }) }));
import TabLayout from "../app/(tabs)/_layout";
it("keeps the iOS 18 tab bar opaque at the scroll edge and fills the selected tab's icon", () => {
  const tabs = TabLayout();
  expect(tabs.props).toMatchObject({ tintColor: "cocoa", backgroundColor: "white", disableTransparentOnScrollEdge: true });
  const triggers = tabs.props.children as { props: { name: string; children: { props: { sf?: unknown } }[] } }[];
  expect(triggers.map(tab => tab.props.name)).toEqual(["(today)", "library", "journal", "ask"]);
  expect(triggers.map(tab => tab.props.children[1].props.sf)).toEqual([
    { default: "sun.max", selected: "sun.max.fill" },
    { default: "bookmark", selected: "bookmark.fill" },
    { default: "book", selected: "book.fill" },
    { default: "bubble.left", selected: "bubble.left.fill" },
  ]);
});
