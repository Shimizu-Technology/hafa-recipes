vi.mock("@/components/design/look-motion", () => ({ LookListItem: ({ children }: { children: unknown }) => children, EASE: {}, SPRING: {} }));
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ fontScale: 1 }));
vi.mock("react-native", () => ({ View: "View", useWindowDimensions: () => ({ fontScale: fixture.fontScale }) }));
vi.mock("react-native-svg", () => ({ default: "Svg", Circle: "Circle", Polyline: "Polyline" }));
vi.mock("../components/ui", () => ({ Button: "Button", Copy: "Copy", ListGroup: "ListGroup", SectionHeader: "SectionHeader", useColors: () => ({ accent: "red" }) }));
import { ProgressRecords } from "../components/progress-records";

it("keeps long record details visible and stacks the value at larger text sizes", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.fontScale = 1.5;
  const record = { key: "1", name: "Long exercise name", best: "100 kg × 10", detail: "12 sessions with notes", trend: [1, 2], lastDone: "2026-11-02" };
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(createElement(ProgressRecords, { records: [record] })); });
  const row = tree.root.findAllByType("View" as never).find(node => node.props.accessibilityLabel?.includes(record.name))!;
  expect(row.props.style).toMatchObject({ paddingVertical: 12, flexDirection: "column" });
  const texts = tree.root.findAllByType("Copy" as never);
  expect(texts.find(node => node.children.includes(record.name))?.props.numberOfLines).toBeUndefined();
  expect(texts.find(node => node.children.includes(record.detail))?.props.numberOfLines).toBeUndefined();
  expect(tree.root.findAllByType("Svg" as never)).toHaveLength(0);
  act(() => tree.unmount());
});
