import { createElement, startTransition, Suspense, type PropsWithChildren } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { blockedContributorsKey, contributorName } from "./safety";
import { ApiError } from "./api";

const f = vi.hoisted(() => ({
  owner: "owner", generation: 1, current: true, storage: null as { isCurrent(): boolean } | null,
  blockedContributors: vi.fn(), unblockContributor: vi.fn(),
}));
vi.mock("@/lib/context", () => ({ useTraining: () => ({
  api: f, owner: f.owner, enrollment: { enrolled: true, generation: f.generation },
  storage: f.storage, isCurrentAccount: () => f.current,
}) }));
vi.mock("@/components/ui", () => ({
  Screen: "Screen", Button: "Button", Card: "Card", Copy: "Copy", Empty: "Empty", Notice: "Notice", SectionHeader: "SectionHeader",
  Sheet: ({ visible, children, ...props }: PropsWithChildren<{ visible: boolean }>) => visible ? createElement("Sheet", props, children) : null,
}));
vi.mock("@/components/query-state", () => ({ QueryState: ({ loading, error, retry, children, loadingLabel, errorMessage }: PropsWithChildren<{ loading: boolean; error: Error | null; retry(): void; loadingLabel?: string; errorMessage?: string }>) =>
  loading ? createElement("Loading", { label: loadingLabel }) : error ? createElement("Error", { retry }, errorMessage ?? error.message) : children,
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
  f.owner = "owner"; f.generation = 1; f.current = true; f.storage = { isCurrent: () => f.current };
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
  expect(JSON.stringify(tree!.toJSON())).toContain("Couldn’t confirm the unblock. Try again.");
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
  expect(JSON.stringify(tree!.toJSON())).toContain("Couldn’t load blocked contributors. Try again.");
  await act(async () => { nodes("Error")[0].props.retry(); }); await settle();
  expect(button("Unblock Håfa member")).toBeDefined();
});
it("keeps account recovery guidance instead of replacing it with a loading error", async () => {
  f.blockedContributors.mockRejectedValueOnce(new ApiError("Sign in again to manage this account.", 401));
  await render();
  expect(JSON.stringify(tree!.toJSON())).toContain("Sign in again to manage this account.");
  expect(nodes("Empty")).toHaveLength(0);
});
it("announces what is loading while the blocked contributors request is pending", async () => {
  f.blockedContributors.mockReturnValue(new Promise(() => {}));
  await render();
  expect(nodes("Loading")[0].props.label).toBe("Loading blocked contributors");
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

it("an abandoned account render cannot retire the committed unblock acknowledgement", async () => {
  const gate = deferred(); f.unblockContributor.mockReturnValueOnce(gate.promise);
  let suspended = false;
  const waiting = new Promise<never>(() => undefined);
  function Blocker() { if (suspended) throw waiting; return null; }
  const screen = () => createElement(QueryClientProvider, { client: cache },
    createElement(Suspense, { fallback: createElement("Fallback") }, createElement(SafetyCenter), createElement(Blocker)));
  await act(async () => { tree = create(screen()); }); await settle();
  await click("Unblock Håfa member"); await click("Unblock");
  const committedKey = key();
  suspended = true; f.owner = "speculative-owner";
  await act(async () => { startTransition(() => tree!.update(screen())); });
  expect(nodes("Fallback")).toHaveLength(0);
  f.blockedContributors.mockResolvedValue([]); gate.resolve(); await settle();
  expect(cache.getQueryData(committedKey)).toEqual([]);
  expect(f.unblockContributor).toHaveBeenCalledOnce();
});
it("a committed storage replacement ignores the old acknowledgement and unlocks confirmation", async () => {
  const gate = deferred(); f.unblockContributor.mockReturnValueOnce(gate.promise);
  await render(); await click("Unblock Håfa member"); await click("Unblock");
  f.storage = { isCurrent: () => true }; await render();
  await click("Unblock Håfa member"); expect(button("Unblock").props.busy).toBe(false);
  gate.resolve(); await settle();
  expect(cache.getQueryData(key())).toEqual(rows);
  expect(JSON.stringify(tree!.toJSON())).not.toContain("Unblocked");
});
