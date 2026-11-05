import React, { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ baby: null as any, mounts: 0 }));
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
import { SpaceBoundary } from "../components/space-boundary";

const own = { id: "p", kind: "personal", role: "parent", generation: 1, access_version: 1 },
  family = { id: "f", kind: "family", role: "parent", generation: 1, access_version: 1 };
const on = (...spaces: object[]) => ({ state: { bootstrap: { spaces } } });
function Editor() { useState(() => { mock.mounts++; }); return null; }
let renderer: ReactTestRenderer | undefined;
const tree = () => <SpaceBoundary><Editor /></SpaceBoundary>;
const to = async (baby: object) => { mock.baby = baby; await act(async () => { renderer!.update(tree()); }); };
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.mounts = 0;
  mock.baby = { state: { bootstrap: {} } };
  await act(async () => { renderer = create(tree()); });
});
afterEach(async () => { await act(async () => renderer?.unmount()); vi.unstubAllGlobals(); });

it("leaves an open screen alone when the flag turns on, or a file's removal moves an access version", async () => {
  await to(on(own));
  await to(on({ ...own, access_version: 2 }));
  expect(mock.mounts).toBe(1);
  await to(on(own, family));
  await to(on(own, { ...family, access_version: 2 }));
  expect(mock.mounts).toBe(2);
});
it("remounts on joining, on a role changing and on leaving", async () => {
  await to(on(own, family));
  expect(mock.mounts).toBe(2);
  await to(on(own, { ...family, role: "caregiver" }));
  expect(mock.mounts).toBe(3);
  await to(on(own));
  expect(mock.mounts).toBe(4);
});
