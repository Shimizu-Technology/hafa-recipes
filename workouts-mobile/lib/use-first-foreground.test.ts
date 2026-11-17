import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
const app = vi.hoisted(() => ({ currentState: "inactive", addEventListener: vi.fn(() => ({ remove: vi.fn() })) }));
vi.mock("react-native", () => ({ AppState: app, Platform: { OS: "ios" } }));
import { useFirstForeground } from "./use-first-foreground";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("catches active between the inactive initial render and passive subscription", async () => {
  function Child() { useLayoutEffect(() => { app.currentState = "active"; }, []); return null; }
  function Root() { const active = useFirstForeground(); return createElement("root", { active }, createElement(Child)); }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Root)); });
  expect(app.addEventListener).toHaveBeenCalledOnce();
  expect(tree.root.findByType("root" as never).props.active).toBe(true);
  await act(async () => tree.unmount());
});
