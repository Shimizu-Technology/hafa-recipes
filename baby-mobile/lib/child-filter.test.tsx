import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ fontScale: 1 }));
vi.mock("react-native", () => ({ useWindowDimensions: () => ({ fontScale: mock.fontScale }) }));
vi.mock("@/lib/context", () => ({ useBaby: () => ({ state: { selectedChild: null, bootstrap: { children: [{ id: "a", name: "Bo" }, { id: "b", name: "Maria Guadalupe" }] } }, commit: vi.fn() }) }));
vi.mock("../components/ui", () => ({ Chips: "Chips" }));
import { ChildFilter } from "../components/child-filter";

let renderer: ReactTestRenderer | undefined;
const chips = () => renderer!.root.findAll((n) => String(n.type) === "Chips")[0].props;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); mock.fontScale = 1; });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("wraps at normal sizes, and at large text scrolls sideways, so long names can't push the page down a screen", async () => {
  await act(async () => { renderer = create(<ChildFilter />); });
  expect(chips().scroll).toBe(false);
  await act(async () => renderer!.unmount());
  mock.fontScale = 1.3;
  await act(async () => { renderer = create(<ChildFilter />); });
  expect(chips().scroll).toBe(true);
});
it("still scrolls at any size where the page asks it to", async () => {
  await act(async () => { renderer = create(<ChildFilter scroll />); });
  expect(chips().scroll).toBe(true);
});
