import { createElement, type PropsWithChildren } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { blockedContributorsKey, contributorName } from "./safety";

const f = vi.hoisted(() => ({
  owner: "owner", generation: 1, current: true,
  blockedContributors: vi.fn(), unblockContributor: vi.fn(),
}));
vi.mock("@/lib/context", () => ({ useTraining: () => ({
  api: f, owner: f.owner, enrollment: { enrolled: true, generation: f.generation },
  storage: { isCurrent: () => f.current }, isCurrentAccount: () => f.current,
}) }));
vi.mock("@/components/ui", () => ({
  Screen: "Screen", Button: "Button", Card: "Card", Copy: "Copy", Empty: "Empty", Notice: "Notice", SectionHeader: "SectionHeader",
  Sheet: ({ visible, children, ...props }: PropsWithChildren<{ visible: boolean }>) => visible ? createElement("Sheet", props, children) : null,
}));
vi.mock("@/components/query-state", () => ({ QueryState: ({ loading, error, retry, children }: PropsWithChildren<{ loading: boolean; error: Error | null; retry(): void }>) =>
  loading ? createElement("Loading") : error ? createElement("Error", { retry }, error.message) : children,
}));
import SafetyCenter from "../app/safety";

let tree: ReactTestRenderer | undefined, cache: QueryClient;
const rows = [{ contributor_id: "member", display_name: "Anonymous Chef", created_at: "2026-10-15" }];
const key = () => blockedContributorsKey(f.owner, f.generation);
const nodes = (type: string) => tree!.root.findAll((node) => String(node.type) === type);
const button = (title: string) => nodes("Button").find((node) => node.props.title === title)!;
async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise((done) => setTimeout(done, 5)); }); }
async function render() {
  await act(async () => {
    const component = createElement(QueryClientProvider, { client: cache }, createElement(SafetyCenter));
    if (tree) tree.update(component); else tree = create(component);
  });
  await settle();
}
async function click(title: string) { await act(async () => { button(title).props.onPress(); }); await settle(); }
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f.owner = "owner"; f.generation = 1; f.current = true;
  f.blockedContributors.mockReset().mockResolvedValue(rows);
  f.unblockContributor.mockReset().mockResolvedValue(undefined);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(async () => { if (tree) await act(async () => { tree!.unmount(); }); tree = undefined; cache.clear(); });

it("uses a neutral name for contributors who have no Recipes profile", () => {
  expect(contributorName("Anonymous Chef")).toBe("Håfa member");
  expect(contributorName("  ")).toBe("Håfa member");
  expect(contributorName("  Coach Nani  ")).toBe("Coach Nani");
});
it("requires confirmation, unblocks a Workouts-only contributor, and refreshes only this owner's Discover", async () => {
  cache.setQueryData([f.owner, "discover", "feed", 1], "owner feed");
  cache.setQueryData(["other", "discover", "feed", 1], "other feed");
  await render();
  expect(button("Unblock Håfa member")).toBeDefined();
  await click("Unblock Håfa member");
  expect(f.unblockContributor).not.toHaveBeenCalled();
  await click("Keep blocked");
  expect(nodes("Sheet")).toHaveLength(0);
  await click("Unblock Håfa member");
  f.blockedContributors.mockResolvedValue([]);
  await click("Unblock");
  expect(f.unblockContributor).toHaveBeenCalledExactlyOnceWith("member");
  expect(cache.getQueryData(key())).toEqual([]);
  expect(nodes("Empty")[0].props.title).toBe("No blocked contributors");
  expect(JSON.stringify(tree!.toJSON())).toContain("Unblocked Håfa member");
  expect(cache.getQueryState([f.owner, "discover", "feed", 1])?.isInvalidated).toBe(true);
  expect(cache.getQueryState(["other", "discover", "feed", 1])?.isInvalidated).toBe(false);
});
it("keeps the contributor and a retryable confirmation after an unblock fails", async () => {
  f.unblockContributor.mockRejectedValueOnce(Error("Could not reach the service."));
  await render(); await click("Unblock Håfa member"); await click("Unblock");
  expect(cache.getQueryData(key())).toEqual(rows);
  expect(nodes("Sheet")).toHaveLength(1);
  expect(JSON.stringify(tree!.toJSON())).toContain("Could not reach the service.");
  f.blockedContributors.mockResolvedValue([]);
  await click("Unblock");
  expect(f.unblockContributor).toHaveBeenCalledTimes(2);
  expect(cache.getQueryData(key())).toEqual([]);
});
it("shows load failures as failures and recovers through retry", async () => {
  f.blockedContributors.mockRejectedValueOnce(Error("Offline"));
  await render();
  expect(nodes("Empty")).toHaveLength(0);
  expect(nodes("Error")).toHaveLength(1);
  await act(async () => { nodes("Error")[0].props.retry(); }); await settle();
  expect(button("Unblock Håfa member")).toBeDefined();
});
it("fences a stale confirmation after local account storage is retired", async () => {
  await render(); await click("Unblock Håfa member");
  f.current = false;
  await click("Unblock");
  expect(f.unblockContributor).not.toHaveBeenCalled();
});
it.each(["owner", "generation"] as const)("ignores a delayed acknowledgement after %s changes", async (field) => {
  const gate = deferred();
  f.unblockContributor.mockReturnValueOnce(gate.promise);
  await render(); await click("Unblock Håfa member"); await click("Unblock");
  const oldKey = key();
  if (field === "owner") f.owner = "another-owner"; else f.generation = 2;
  await render();
  gate.resolve(); await settle();
  expect(cache.getQueryData(oldKey)).toEqual(rows);
  expect(cache.getQueryData(key())).toEqual(rows);
  expect(JSON.stringify(tree!.toJSON())).not.toContain("Unblocked");
  await click("Unblock Håfa member");
  expect(button("Unblock").props.busy).toBe(false);
});
it("deduplicates repeated confirmation taps until the server acknowledges", async () => {
  const gate = deferred(); f.unblockContributor.mockReturnValueOnce(gate.promise);
  await render(); await click("Unblock Håfa member");
  await act(async () => { button("Unblock").props.onPress(); button("Unblock").props.onPress(); });
  expect(f.unblockContributor).toHaveBeenCalledTimes(1);
  f.blockedContributors.mockResolvedValue([]); gate.resolve(); await settle();
});
it("refreshes same-account caches when a confirmed unblock finishes after leaving the screen", async () => {
  const gate = deferred(); f.unblockContributor.mockReturnValueOnce(gate.promise);
  cache.setQueryData([f.owner, "discover", "feed", 1], "owner feed");
  await render(); await click("Unblock Håfa member"); await click("Unblock");
  await act(async () => { tree!.unmount(); }); tree = undefined;
  gate.resolve(); await settle();
  expect(cache.getQueryData(key())).toEqual([]);
  expect(cache.getQueryState([f.owner, "discover", "feed", 1])?.isInvalidated).toBe(true);
});
