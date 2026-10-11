import { createElement, useEffect, StrictMode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { draftKey } from "./drafts";
import type { Enrollment, Workout } from "./models";
import { trainingKey } from "./training";

const fixture = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  authRenders: 0,
  unstableTokenGetter: true,
  token: "initial-token",
  subject: "subject-A",
  foreground: new Set<(state: string) => void>(),
  erase: vi.fn(),
}));
const rawStorage = vi.hoisted(() => ({
  getItem: async (key: string) => fixture.disk.get(key) ?? null,
  setItem: async (key: string, value: string) => { fixture.disk.set(key, value); },
  removeItem: async (key: string) => { fixture.disk.delete(key); },
  getAllKeys: async () => [...fixture.disk.keys()],
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: rawStorage }));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  AppState: { addEventListener: (_: string, listener: (state: string) => void) => {
    fixture.foreground.add(listener);
    return { remove: () => fixture.foreground.delete(listener) };
  } },
}));
vi.mock("@/components/ui", () => ({ Screen: "Screen", Notice: "Notice", Button: "Button", Copy: "Copy" }));
vi.mock("./config", () => ({ configuration: {
  apiBase: "https://synthetic.invalid", clerkEnvironment: "development", clerkKey: "synthetic-key",
} }));
vi.mock("@clerk/expo", () => {
  const stable = async () => fixture.token;
  return { useAuth: () => {
    // Fail deterministically instead of letting an effect loop hang the test worker.
    if (++fixture.authRenders > 50) throw Error("Provider did not settle: token-getter render loop");
    const tokenForThisRender = fixture.token;
    return { userId: fixture.subject, getToken: fixture.unstableTokenGetter ? async () => tokenForThisRender : stable };
  } };
});
vi.mock("./private-device", async () => {
  const { createPrivateStorageRegistry } = await import("./private-storage");
  const registry = createPrivateStorageRegistry(rawStorage);
  return { privateRegistry: registry, erasePrivateDeviceData: async (owner: string, binding: string) => {
    fixture.erase(owner, binding);
    await registry.erase(owner);
    await rawStorage.removeItem(draftKey(binding, "verified-identity"));
  } };
});
import { TrainingProvider, useOfflineTraining, useTraining } from "./context";

type Training = ReturnType<typeof useTraining>;
type Offline = ReturnType<typeof useOfflineTraining>;
let observed: { training: Training; offline: Offline } | null = null;
let mounts = 0, unmounts = 0;
let renderer: ReactTestRenderer | undefined;
let cache: QueryClient;
const member: Enrollment = { enrolled: true, generation: 1, adult_confirmed: true,
  shared_account_deletion_acknowledged: true, disclosure_version: 1, enrolled_at: null };
let serverMember = member;
const transport = vi.fn<typeof fetch>();
function Consumer() {
  observed = { training: useTraining(), offline: useOfflineTraining() };
  useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
  return createElement("Training", { units: observed.training.units, ready: observed.offline.ready });
}
const tree = () => createElement(QueryClientProvider, { client: cache },
  createElement(StrictMode, null, createElement(TrainingProvider, null, createElement(Consumer))));
async function settle() {
  // QueryClient notification scheduling is asynchronous; flush actual React effects each turn.
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((done) => setTimeout(done, 5)); });
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.disk.clear(); fixture.foreground.clear(); fixture.erase.mockClear();
  fixture.authRenders = 0; fixture.unstableTokenGetter = true; fixture.token = "initial-token"; fixture.subject = "subject-A";
  observed = null; mounts = 0; unmounts = 0; serverMember = member;
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  fixture.disk.set(draftKey("A", "enrollment"), JSON.stringify(member));
  fixture.disk.set(draftKey("A", "units"), '"imperial"');
  transport.mockReset();
  transport.mockImplementation(async (url) => {
    if (String(url).endsWith("/api/users/me/identity")) return new Response(JSON.stringify({ id: fixture.subject === "subject-A" ? "A" : "B" }));
    if (String(url).endsWith("/enrollment")) return new Response(JSON.stringify(serverMember));
    throw Error("Unexpected synthetic request");
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined; cache.clear(); vi.unstubAllGlobals();
});

it("mounted provider settles with unstable Clerk getToken and keeps training mounted on unchanged foreground verification", async () => {
  await act(async () => { renderer = create(tree()); });
  await settle();
  expect(observed?.offline.ready).toBe(true);
  expect(observed?.training.enrollment).toEqual(member);
  expect(fixture.authRenders).toBeLessThan(25);
  const store = observed!.offline.store;
  const workout: Workout = { id: "workout", revision: 1, generation: 1, title: "Saved strength",
    kind: "session", provenance: "user", blocks: [{ id: "main", label: "Strength", grouping: "sequential",
      exercises: [{ name: "Row", sets: 1, reps_min: 8, reps_max: 8 }] }] };
  await act(async () => { await store!.start(workout, { workout_id: "workout", workout_revision: 1 }, "unfinished-session"); });
  const savedActual = fixture.disk.get(trainingKey("A", 1));
  const priorMounts = mounts, priorUnmounts = unmounts;
  fixture.token = "refreshed-token";
  await act(async () => { renderer!.update(tree()); });
  await act(async () => { fixture.foreground.forEach((listener) => listener("active")); });
  await settle();
  expect(observed!.offline.store).toBe(store);
  expect(observed!.offline.ready).toBe(true);
  expect(observed!.offline.state.active?.id).toBe("unfinished-session");
  expect(fixture.disk.get(trainingKey("A", 1))).toBe(savedActual);
  expect([mounts, unmounts]).toEqual([priorMounts, priorUnmounts]);
  expect(fixture.erase).not.toHaveBeenCalled();
  const calls = transport.mock.calls.filter(([url]) => String(url).endsWith("/enrollment"));
  expect(calls.length).toBeGreaterThan(1);
  expect(new Headers(calls.at(-1)![1]?.headers).get("Authorization")).toBe("Bearer refreshed-token");
});

it("mounted metric selection survives same-generation foreground verification and stays saved on disk", async () => {
  fixture.unstableTokenGetter = false;
  await act(async () => { renderer = create(tree()); }); await settle();
  const store = observed!.offline.store;
  await act(async () => { await observed!.training.setUnits("metric"); });
  expect(observed!.training.units).toBe("metric");
  // A fresh same-generation DTO also exercises the coordinator's server fast path.
  serverMember = { ...member, enrolled_at: "2026-10-10T00:00:00Z" };
  await act(async () => { fixture.foreground.forEach((listener) => listener("active")); }); await settle();
  expect(observed!.training.units).toBe("metric");
  expect(fixture.disk.get(draftKey("A", "units"))).toBe('"metric"');
  expect(observed!.offline.store).toBe(store);
  expect(fixture.erase).not.toHaveBeenCalled();
});

it("a stable token wrapper still fences an earlier owner's API when the signed-in binding changes", async () => {
  await act(async () => { renderer = create(tree()); }); await settle();
  const oldApi = observed!.training.api;
  fixture.subject = "subject-B";
  await act(async () => { renderer!.update(tree()); }); await settle();
  expect(observed!.training.owner).toBe("B");
  const calls = transport.mock.calls.length;
  await expect(oldApi.enrollment()).rejects.toMatchObject({ status: 409 });
  expect(transport.mock.calls.length).toBe(calls);
  expect(fixture.erase).not.toHaveBeenCalled();
});

it("stable provider lifetime still retires private state on authoritative foreground deletion", async () => {
  await act(async () => { renderer = create(tree()); }); await settle();
  const originalStorage = observed!.training.storage;
  await originalStorage.setItem(draftKey("A", "profile:1"), "old private profile");
  fixture.disk.set(draftKey("B", "profile:1"), "another owner's profile");
  serverMember = { ...member, generation: 2, enrolled: false };
  await act(async () => { fixture.foreground.forEach((listener) => listener("active")); }); await settle();
  expect(observed!.training.enrollment).toEqual(serverMember);
  expect(observed!.offline.store).toBeNull();
  expect(fixture.erase).toHaveBeenCalledOnce();
  expect(fixture.disk.has(draftKey("A", "profile:1"))).toBe(false);
  expect(fixture.disk.get(draftKey("B", "profile:1"))).toBe("another owner's profile");
  await expect(originalStorage.setItem(draftKey("A", "profile:1"), "stale write")).rejects.toThrow("retired");
});
