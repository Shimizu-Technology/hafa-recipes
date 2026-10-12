import React, { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { LogoutRecoveryBoundary } from "../components/logout-recovery-boundary";
import { createLogoutRecovery, clearLogoutQueries, logoutBinding, logoutRecoveryKey, type LogoutAuth, type LogoutRecovery } from "./logout-recovery";
import { createPrivateStorageRegistry, ownedStorageKey } from "./private-storage";
import { configuration } from "./config";
import AccountData from "../app/account-data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let controller: LogoutRecovery;
let screenContext: Record<string, unknown>;
vi.mock("@clerk/expo", () => ({ useAuth: () => ({ userId: "subject-A", sessionId: "session-A" }) }));
vi.mock("@/lib/context", () => ({ useTraining: () => screenContext }));
vi.mock("@/lib/logout-recovery-native", () => ({ get logoutRecovery() { return controller; } }));
vi.mock("@/lib/export-file", () => ({ savePrivateExport: vi.fn() }));
// Deletion recovery owns its fixture; the real focused export hook is exercised in export-job-screen.test.ts.
vi.mock("@/lib/use-export-job", () => ({ useExportJob: () => ({
  view: { phase: "idle", command: null, job: null, busy: false, error: "", message: "", pages: 0, invalidated: false },
  enabled: true, useJobs: false, knownLegacy: true, pollStopped: false, controller: null,
  capability: { isError: false }, check() {},
}) }));
vi.mock("@/components/reminders-provider", () => ({ useReminders: () => ({ controller: { cleanupOwned: async () => {} } }) }));
vi.mock("@/components/ui", () => ({
  Screen: ({ children }: React.PropsWithChildren) => React.createElement("screen", null, children),
  Card: ({ children }: React.PropsWithChildren) => React.createElement("card", null, children),
  Copy: ({ children }: React.PropsWithChildren) => React.createElement("copy", null, children),
  Notice: ({ children }: React.PropsWithChildren) => React.createElement("notice", null, children),
  Choice: ({ label, onPress }: { label: string; onPress(): void }) => React.createElement("button", { onClick: onPress }, label),
  Button: ({ title, onPress, disabled, busy }: { title: string; onPress(): void; disabled?: boolean; busy?: boolean }) =>
    React.createElement("button", { onClick: onPress, disabled: disabled || busy }, title),
}));
const subject = "subject-A";
const binding = logoutBinding(configuration.clerkEnvironment, configuration.clerkKey, subject);
const acknowledgement = { version: 1 as const, owner: "A", binding, subject, sessionId: "session-A" };
const signedIn: LogoutAuth = { loaded: true, binding, subject, sessionId: "session-A" };
const signedOut: LogoutAuth = { loaded: true, binding: null, subject: null, sessionId: null };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function memory() {
  const map = new Map<string, string>();
  const raw = { getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => { map.set(key, value); },
    removeItem: async (key: string) => { map.delete(key); }, getAllKeys: async () => [...map.keys()] };
  const registry = createPrivateStorageRegistry(raw);
  const cleanup = vi.fn(async (owner: string, authBinding: string) => {
    await registry.erase(owner);
    await raw.removeItem(`hafa-workouts:v1:${encodeURIComponent(authBinding)}:verified-identity`);
  });
  return { map, raw, cleanup, registry };
}
function fixture() {
  const f = memory();
  f.map.set("hafa-workouts:v1:A:profile", "PRIVATE_A");
  f.map.set("hafa-workouts:v1:B:profile", "PRIVATE_B");
  controller = createLogoutRecovery({ storage: f.raw, cleanup: f.cleanup });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["A", "profile", 1], "PRIVATE_A");
  cache.setQueryData(["identity", binding], { id: "A" });
  cache.setQueryData(["B", "profile", 1], "PRIVATE_B");
  const deleted = vi.fn(async () => ({ message: "Deleted", cleanup: { status: "pending" } }));
  screenContext = { owner: "A", enrollment: { enrolled: true, generation: 1 }, storage: f.registry.capture("A"),
    api: { deleteHafaAccount: deleted }, eraseLocalData: () => f.cleanup("A", binding), invalidateAccount: vi.fn() };
  return { ...f, cache, deleted };
}
async function settle() { for (let i = 0; i < 5; i++) await act(async () => { await new Promise<void>((done) => setTimeout(done, 1)); }); }
function button(tree: ReactTestRenderer, title: string) {
  return tree.root.findAllByType("button").find((node) => node.children.join("") === title)!;
}
function mount(f: ReturnType<typeof fixture>, sdk: (options: { sessionId: string }) => Promise<void>, initial = signedIn) {
  let auth = initial;
  let tree: ReactTestRenderer;
  let privateMounts = 0;
  function PrivateRoutes() {
    useEffect(() => { privateMounts++; }, []);
    const q = useQuery({ queryKey: ["A", "profile", 1], queryFn: async () => "PRIVATE_A", enabled: false });
    return React.createElement("private-route", null, q.data, React.createElement(AccountData));
  }
  function OtherAccount() {
    const q = useQuery({ queryKey: ["B", "profile", 1], queryFn: async () => "PRIVATE_B", enabled: false });
    return React.createElement("other-account", null, q.data);
  }
  function render() {
    return React.createElement(QueryClientProvider, { client: f.cache },
      React.createElement(LogoutRecoveryBoundary, { controller, auth, signOut: sdk,
        clearPrivate: (record) => clearLogoutQueries(f.cache, record),
        renderRecovery: (state) => React.createElement("recovery", null, state.error,
          React.createElement("button", { onClick: state.retry, disabled: state.busy }, "Retry cleanup and sign-out")),
        children: auth.subject === subject ? React.createElement(PrivateRoutes) :
          auth.subject ? React.createElement(OtherAccount) : React.createElement("signed-out"),
      }));
  }
  return { async start() { await act(async () => { tree = create(render()); }); await settle(); return tree!; },
    setAuth(value: LogoutAuth) { auth = value; tree!.update(render()); },
    async auth(value: LogoutAuth) { await act(async () => { auth = value; tree!.update(render()); }); await settle(); },
    tree: () => tree!, mounts: () => privateMounts,
    async close() { await act(async () => { tree!.unmount(); }); f.cache.clear(); },
  };
}
beforeEach(() => { vi.clearAllMocks(); });

it("mounted real AccountData acknowledges deletion once, clears private queries, and retries only rejected SDK sign-out", async () => {
  const f = fixture(); let app: ReturnType<typeof mount>;
  const sdk = vi.fn(async () => { if (sdk.mock.calls.length === 1) throw Error("SDK offline"); app.setAuth(signedOut); });
  app = mount(f, sdk); const tree = await app.start();
  expect(tree.root.findAll((node) => String(node.type) === "private-route")).toHaveLength(1);
  await act(async () => { button(tree, "Review whole-account deletion").props.onClick(); });
  await act(async () => { button(tree, "I understand my Recipes and Workouts data will both be erased.").props.onClick(); });
  await act(async () => { button(tree, "Delete my whole Håfa account").props.onClick(); }); await settle();
  expect(f.deleted).toHaveBeenCalledOnce(); expect(sdk).toHaveBeenCalledWith({ sessionId: "session-A" });
  expect(tree.root.findAll((node) => String(node.type) === "private-route")).toHaveLength(0);
  expect(f.cache.getQueryData(["A", "profile", 1])).toBeUndefined();
  expect(f.cache.getQueryData(["identity", binding])).toBeUndefined();
  expect(f.cache.getQueryData(["B", "profile", 1])).toBe("PRIVATE_B");
  expect(f.map.has("hafa-workouts:v1:A:profile")).toBe(false);
  expect(f.map.get(logoutRecoveryKey(binding))).toBe(JSON.stringify(acknowledgement));
  expect(JSON.stringify(tree.toJSON())).toContain("Sign-out did not finish");
  await act(async () => { button(tree, "Retry cleanup and sign-out").props.onClick(); }); await settle();
  expect(f.deleted).toHaveBeenCalledOnce(); expect(sdk).toHaveBeenCalledTimes(2);
  expect(f.map.has(logoutRecoveryKey(binding))).toBe(false);
  expect(f.map.get("hafa-workouts:v1:B:profile")).toBe("PRIVATE_B"); await app.close();
});

it("cold mounted recovery works without training identity and keeps ACK through a failed native cleanup", async () => {
  const f = fixture(); f.map.set(logoutRecoveryKey(binding), JSON.stringify(acknowledgement));
  f.cache.removeQueries({ queryKey: ["identity", binding] });
  f.cleanup.mockRejectedValueOnce(Error("Device files locked"));
  const sdk = vi.fn(async () => {}); const app = mount(f, sdk); const tree = await app.start();
  expect(app.mounts()).toBe(0); expect(f.deleted).not.toHaveBeenCalled(); expect(sdk).not.toHaveBeenCalled();
  expect(f.map.has(logoutRecoveryKey(binding))).toBe(true);
  expect(JSON.stringify(tree.toJSON())).toContain("still needs private data cleanup");
  await app.auth(signedOut); await settle();
  expect(f.map.has(logoutRecoveryKey(binding))).toBe(false); expect(sdk).not.toHaveBeenCalled();
  expect(f.deleted).not.toHaveBeenCalled(); await app.close();
});

it("fresh account switching never signs out the new account or clears its private queries", async () => {
  const f = fixture(); f.map.set(logoutRecoveryKey(binding), JSON.stringify(acknowledgement));
  const held = deferred<void>(); f.cleanup.mockImplementationOnce(async () => held.promise);
  const sdk = vi.fn(async () => {}); const app = mount(f, sdk); const tree = await app.start();
  const other = { loaded: true, binding: "other-binding", subject: "subject-B", sessionId: "session-B" };
  await app.auth(other); held.resolve(); await settle();
  expect(sdk).not.toHaveBeenCalled(); expect(f.cache.getQueryData(["B", "profile", 1])).toBe("PRIVATE_B");
  expect(f.map.has(logoutRecoveryKey(binding))).toBe(true);
  expect(tree.root.findAll((node) => String(node.type) === "recovery")).toHaveLength(0); expect(f.deleted).not.toHaveBeenCalled(); await app.close();
});

it("SDK completion alone cannot reopen private routes before its fresh auth hooks acknowledge sign-out", async () => {
  const f = fixture(); f.map.set(logoutRecoveryKey(binding), JSON.stringify(acknowledgement));
  const sdk = vi.fn(async () => {}); const app = mount(f, sdk); const tree = await app.start();
  expect(sdk).toHaveBeenCalledOnce(); expect(app.mounts()).toBe(0);
  expect(tree.root.findAll((node) => String(node.type) === "recovery")).toHaveLength(1); expect(f.map.has(logoutRecoveryKey(binding))).toBe(true);
  await app.auth(signedOut); expect(f.map.has(logoutRecoveryKey(binding))).toBe(false);
  expect(sdk).toHaveBeenCalledOnce(); expect(f.deleted).not.toHaveBeenCalled(); await app.close();
});

it("ACK metadata survives private erasure and a delayed initial write cannot resurrect completed recovery", async () => {
  const f = fixture(), held = deferred<void>(), entered = deferred<void>(); let first = true;
  const original = f.raw.setItem;
  f.raw.setItem = async (key, value) => { if (first && key === logoutRecoveryKey(binding)) { first = false; entered.resolve(); await held.promise; } await original(key, value); };
  controller = createLogoutRecovery({ storage: f.raw, cleanup: f.cleanup }); await controller.hydrate();
  const sdk = vi.fn(async () => {}); let retry: Promise<void> | undefined, started = false;
  controller.subscribe(() => { if (!started && controller.snapshot().records.length) {
    started = true;
    retry = controller.retry(acknowledgement, { auth: () => signedOut, signOut: sdk, clearPrivate: (record) => clearLogoutQueries(f.cache, record) });
  } });
  const acknowledgementWrite = controller.acknowledge(acknowledgement, (record) => clearLogoutQueries(f.cache, record));
  await entered.promise;
  held.resolve(); await acknowledgementWrite; await retry;
  expect(ownedStorageKey(logoutRecoveryKey(binding), "A")).toBe(false);
  expect(f.map.has(logoutRecoveryKey(binding))).toBe(false); expect(sdk).not.toHaveBeenCalled(); f.cache.clear();
});

it("a failed durable ACK write keeps mounted privacy recovery and never signs out before persistence succeeds", async () => {
  const f = fixture(); let fail = true; const original = f.raw.setItem;
  f.raw.setItem = async (key, value) => { if (fail && key === logoutRecoveryKey(binding)) throw Error("Disk unavailable"); await original(key, value); };
  const sdk = vi.fn(async () => { expect(f.map.has(logoutRecoveryKey(binding))).toBe(true); throw Error("SDK unavailable"); });
  const app = mount(f, sdk); const tree = await app.start();
  await act(async () => { await expect(controller.acknowledge(acknowledgement, (record) => clearLogoutQueries(f.cache, record))).rejects.toThrow("acknowledgement"); });
  await settle(); expect(sdk).not.toHaveBeenCalled(); expect(tree.root.findAll((node) => String(node.type) === "private-route")).toHaveLength(0);
  expect(f.cache.getQueryData(["A", "profile", 1])).toBeUndefined();
  fail = false; await act(async () => { button(tree, "Retry cleanup and sign-out").props.onClick(); }); await settle();
  expect(sdk).toHaveBeenCalledOnce(); expect(f.deleted).not.toHaveBeenCalled();
  expect(f.map.has(logoutRecoveryKey(binding))).toBe(true); await app.close();
});

it("a newly selected session for the same subject is preserved instead of defaulting SDK sign-out to it", async () => {
  const f = fixture(); f.map.set(logoutRecoveryKey(binding), JSON.stringify(acknowledgement));
  const sdk = vi.fn(async () => {}); const app = mount(f, sdk, { ...signedIn, sessionId: "new-session-A" }); await app.start();
  expect(sdk).not.toHaveBeenCalled(); expect(f.map.has(logoutRecoveryKey(binding))).toBe(false);
  expect(f.cache.getQueryData(["A", "profile", 1])).toBeUndefined(); expect(f.deleted).not.toHaveBeenCalled(); await app.close();
});

it("a disposed recovery boundary cannot use its old auth hooks to sign out after another account mounts", async () => {
  const f = fixture(); f.map.set(logoutRecoveryKey(binding), JSON.stringify(acknowledgement));
  const held = deferred<void>(); f.cleanup.mockImplementationOnce(async () => held.promise);
  const sdk = vi.fn(async () => {}); const old = mount(f, sdk); await old.start();
  await act(async () => { old.tree().unmount(); });
  const next = mount(f, sdk, { loaded: true, binding: "other-binding", subject: "subject-B", sessionId: "session-B" }); await next.start();
  held.resolve(); await settle();
  expect(sdk).not.toHaveBeenCalled(); expect(f.cache.getQueryData(["B", "profile", 1])).toBe("PRIVATE_B");
  expect(f.map.has(logoutRecoveryKey(binding))).toBe(true); await next.close();
});
