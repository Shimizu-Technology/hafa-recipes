import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
import { emptyState } from "./models";
const mock = vi.hoisted(() => ({ b: null as any, lease: 1, changeOwner: false }));
vi.mock("../lib/context", () => ({ useBaby: () => mock.b }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-crypto", async () => {
  const { createHash } = await import("node:crypto");
  return { randomUUID: () => "candidate", CryptoDigestAlgorithm: { SHA256: "sha256" }, digestStringAsync: async (_: string, text: string) => {
    if (mock.changeOwner) mock.lease++;
    return createHash("sha256").update(text).digest("hex");
  } };
});
vi.mock("../components/ui", async () => {
  const React = await import("react");
  return Object.fromEntries(["Button", "Card", "Choice", "Copy", "Field", "FilterChips", "Notice", "Row", "Screen"].map((name) => [name, (props: any) => React.createElement(name, props, props.children)]));
});
import PasteVisits from "../app/paste-visits";
let tree: ReactTestRenderer;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mock.lease = 1; mock.changeOwner = false;
  mock.b = { owner: "stable-app-owner", state: { ...emptyState(), bootstrap: { generation: 1, personal_space_id: "me", profile: { timezone: "Pacific/Guam" }, children: [] } },
    api: { lease: () => mock.lease, assertLease: (lease: number) => { if (lease !== mock.lease) throw Error("Your account changed."); } },
    commit: vi.fn(async (change: any) => { mock.b.state = change(mock.b.state); }), sync: vi.fn(async () => {}) };
});
const host = (type: string, key: string, value: string) => tree.root.findAll((node) => node.type === type && node.props[key] === value)[0];
async function review(text: string) {
  const before = mock.b.state.outbox.length;
  await act(async () => { tree = create(<PasteVisits />); });
  await act(async () => host("Field", "label", "Paste your note").props.onChange(text));
  await act(async () => host("Button", "title", "Review dated items").props.onPress());
  expect(mock.b.state.outbox).toHaveLength(before);
  await act(async () => host("Choice", "label", "Save this item").props.onPress());
}
it("keeps all words, writes only on confirmation, and reuses identities on a repeated review", async () => {
  const text = "April 1, 2026 first test 💛\n" + "Words to keep. ".repeat(1000);
  await review(text);
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
  expect(mock.b.state.outbox).toHaveLength(2);
  expect(mock.b.state.outbox.every((item: any) => item.record.body === text && item.space_id === "me")).toBe(true);
  const hasUndefined = (value: any): boolean => value === undefined || (value !== null && typeof value === "object" && Object.values(value).some(hasUndefined));
  expect(hasUndefined(mock.b.state.outbox)).toBe(false);
  await act(async () => tree.unmount());
  await review(text);
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
  expect(mock.b.state.outbox).toHaveLength(2);
  await act(async () => tree.unmount());
});
it("fences an account change during asynchronous identity preparation", async () => {
  await review("2026-11-08 GBS swab done");
  mock.changeOwner = true;
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
  expect(mock.b.commit).not.toHaveBeenCalled();
  expect(mock.b.state.outbox).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain("Your account changed.");
  await act(async () => tree.unmount());
});
