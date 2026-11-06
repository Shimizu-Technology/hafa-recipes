import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, type DeviceState, type Mutation } from "./models";

const scope = vi.hoisted(() => ({ account: null as any }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("../components/ui", () => ({ Copy: "Copy", PressTarget: "PressTarget", Row: "Row", Icon: "Icon", useColors: () => ({}) }));
import { SyncStatus } from "../components/sync-status";

const prefs: Mutation = { id: "p", generation: 1, type: "reminder_prefs", patch: { kinds: { event: { enabled: true } } } };
let view: ReactTestRenderer;
const render = async (reminders?: { push: boolean }) => {
  scope.account = { online: true, syncing: false, error: "", unreachable: false, state: { ...emptyState(), outbox: [prefs], bootstrap: { generation: 1, children: [], reminders } } as unknown as DeviceState };
  await act(async () => { view = create(<SyncStatus />); });
};
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React); });
afterEach(async () => { await act(async () => view.unmount()); vi.unstubAllGlobals(); });

it("settings kept while the flag is off don't read as something still sending", async () => {
  await render();
  expect(view.toJSON()).toBeNull();
});
it("with the flag on they do", async () => {
  await render({ push: true });
  expect(view.root.findAll((n) => String(n.type) === "PressTarget")).toHaveLength(1);
});

it("keeps unfinished drafts discoverable with no queued work or family notice", async () => {
  await render(); scope.account.state.outbox = [];
  scope.account.state.heldDrafts = [{ id: "held", draft: {} }];
  await act(async () => view.update(<SyncStatus />));
  const row = view.root.findAll((n) => String(n.type) === "Row")[0];
  expect(row.props.title).toBe("1 unfinished draft");
  expect(row.props.detail).toContain("on this phone");
});
