import { createElement, type PropsWithChildren } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { WatchAttentionRow } from "../components/watch-attention";
import { WatchCollisions } from "../components/watch-collision";
import type { TrainingState } from "./training";
import { nov17Class } from "./fixtures/nov17-class";
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("expo-router", () => ({ router: navigation }));
vi.mock("@/components/ui", () => {
  const wrap = ({ children }: PropsWithChildren) => createElement("view", null, children);
  return { Card: wrap, Copy: wrap, Notice: wrap, ButtonRow: wrap,
    Button: ({ title, onPress }: { title: string; onPress(): void }) => createElement("button", { onClick: onPress }, title),
    ListRow: ({ title, onPress }: { title: string; onPress(): void }) => createElement("row", { onClick: onPress }, title) };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("opens the quiet attention row, explains the reason and confirms before discarding", async () => {
  const discard = vi.fn(async () => undefined); let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(WatchAttentionRow, { items: [{ id: "result", title: "Watch result", reason: "The saved class snapshot is missing.", discardable: true }], discard })); });
  expect(JSON.stringify(tree.toJSON())).toContain("1 watch result needs attention");
  expect(JSON.stringify(tree.toJSON())).not.toContain("snapshot");
  await act(async () => tree.root.findByType("row" as never).props.onClick());
  expect(JSON.stringify(tree.toJSON())).toContain("snapshot");
  const button = (name: string) => tree.root.findAllByType("button" as never).find(b => b.children.join("") === name)!;
  await act(async () => button("Discard result").props.onClick()); expect(discard).not.toHaveBeenCalled();
  await act(async () => button("Cancel").props.onClick()); expect(discard).not.toHaveBeenCalled();
  await act(async () => button("Discard result").props.onClick());
  await act(async () => button("Discard").props.onClick()); expect(discard).toHaveBeenCalledExactlyOnceWith("result");
  await act(async () => tree.unmount());
});
it("links to the exact saved watch and phone recordings, and hides yesterday's notice", async () => {
  const request = { client_session_id: "watch", started_at: "2026-11-17T00:00:00Z", finished_at: "2026-11-17T00:15:00Z", status: "completed" as const, actuals: [] };
  const state: TrainingState = { version: 1, generation: 1, active: null, history: [
    { request, workout: nov17Class, generation: 1, state: "synced", synced_id: "watch-server", watch: { parts: [], duplicate_phone_id: "phone" } },
    { request: { ...request, client_session_id: "phone" }, workout: nov17Class, generation: 1, state: "synced", synced_id: "phone-server" }] };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(WatchCollisions, { state, today: "2026-11-17", timezone: "Pacific/Guam" })); });
  for (const b of tree.root.findAllByType("button" as never)) await act(async () => b.props.onClick());
  expect(navigation.push.mock.calls.map(c => c[0].params.id)).toEqual(["watch-server", "phone-server"]);
  await act(async () => tree.update(createElement(WatchCollisions, { state, today: "2026-11-18", timezone: "Pacific/Guam" })));
  expect(tree.toJSON()).toBeNull(); await act(async () => tree.unmount());
});
