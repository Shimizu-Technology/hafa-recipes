import { expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createEnrollmentBootstrap, createVerifiedIdentityCache } from "./enrollment-bootstrap";
import { createPrivateStorageRegistry } from "./private-storage";
import { draftKey, drafts } from "./drafts";
import { createTrainingStore, trainingKey } from "./training";
import { commitTrainingSetup, saveTrainingSetup, profileKey } from "./onboarding-state";
import { initialProfile, type Enrollment } from "./models";

const member = (generation: number | null, enrolled = true): Enrollment => ({
  generation, enrolled, adult_confirmed: enrolled, shared_account_deletion_acknowledged: enrolled,
  disclosure_version: 1, enrolled_at: enrolled ? "2026-10-10T00:00:00Z" : null,
});
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function fixture(saved: Enrollment | null) {
  const map = new Map<string, string>();
  const binding = "test:key:subject-A";
  let current = true;
  const raw = { getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => { map.set(key, value); },
    removeItem: async (key: string) => { map.delete(key); }, getAllKeys: async () => [...map.keys()] };
  const registry = createPrivateStorageRegistry(raw);
  const identities = createVerifiedIdentityCache(raw);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const old = registry.capture("A");
  map.set(draftKey("A", "enrollment"), JSON.stringify(saved));
  map.set(draftKey("A", "units"), '"metric"');
  map.set(draftKey(binding, "verified-identity"), JSON.stringify({ id: "A", binding }));
  map.set(trainingKey("A", 1), JSON.stringify({ version: 1, generation: 1, active: null, history: [] }));
  map.set(draftKey("B", "profile:1"), "other private owner");
  const states: unknown[] = [];
  const disk = deferred<{ enrollment: Enrollment | null; units: "metric" }>();
  const retire = vi.fn(async () => { await registry.erase("A"); await raw.removeItem(draftKey(binding, "verified-identity")); });
  const boot = createEnrollmentBootstrap({ owner: "A", isCurrent: () => current,
    load: () => disk.promise, retire,
    clearQueries: () => cache.removeQueries({ predicate: (q) => q.queryKey[0] === "A" && q.queryKey[1] !== "enrollment" }),
    fresh() { const scope = registry.capture("A"); return { drafts: drafts(scope), isCurrent: scope.isCurrent }; },
    publish(state) { states.push(state); }, publishEnrollment(value) { cache.setQueryData(["A", "enrollment"], value); },
    async rememberIdentity() { const scope = registry.capture("A"); await identities.save(binding, "A", () => current && scope.isCurrent()); },
  });
  return { map, raw, registry, old, identities, binding, boot, cache, retire, states,
    stop() { current = false; boot.dispose(); },
    resolveDisk() { disk.resolve({ enrollment: saved, units: "metric" }); },
  };
}

it.each(["response-first", "disk-first"])("retires cold-launch old generation in either input order: %s", async (order) => {
  const f = fixture(member(1));
  f.cache.setQueryData(["A", "profile", 1], { private: "old" });
  const hydrated = f.boot.hydrate();
  if (order === "response-first") { await f.boot.server(member(2, false)); expect(f.boot.snapshot().status).toBe("pending"); f.resolveDisk(); }
  else { f.resolveDisk(); await hydrated; expect(f.boot.snapshot().status).toBe("pending"); await f.boot.server(member(2, false)); }
  await hydrated;
  expect(f.boot.snapshot()).toMatchObject({ status: "ready", enrollment: member(2, false), units: "imperial" });
  expect(f.retire).toHaveBeenCalledOnce();
  expect(f.map.has(trainingKey("A", 1))).toBe(false);
  expect(f.map.get(draftKey("B", "profile:1"))).toBe("other private owner");
  expect(f.cache.getQueryData(["A", "profile", 1])).toBeUndefined();
  await expect(f.old.setItem(draftKey("A", "profile:1"), "late old data")).rejects.toThrow("retired");
  expect(await f.identities.load(f.binding)).toEqual({ id: "A", binding: f.binding });
  f.cache.clear();
});

it("does not expose hydrated private state while server verification is pending; offline fallback waits for failure", async () => {
  const f = fixture(member(1));
  const hydrated = f.boot.hydrate(); f.resolveDisk(); await hydrated;
  expect(f.boot.snapshot().status).toBe("pending");
  await f.boot.server(null, 0);
  expect(f.boot.snapshot()).toMatchObject({ status: "ready", enrollment: member(1) });
  expect(f.retire).not.toHaveBeenCalled();
  const store = createTrainingStore(f.registry.capture("A"), "A", 1); await store.load();
  expect(store.snapshot().generation).toBe(1);
  f.cache.clear();
});

it.each([401, 403])("rejects private fallback when enrollment is denied: %s", async (status) => {
  const f = fixture(member(1)); const hydrated = f.boot.hydrate(); f.resolveDisk(); await hydrated;
  await f.boot.server(null, status); expect(f.boot.snapshot().status).toBe("blocked");
  expect(() => f.boot.beginSetup(1)).toThrow("Refresh"); f.cache.clear();
});

it("ignores delayed disk results and never writes/cleans another owner after a scope switch", async () => {
  const f = fixture(member(1)); const pending = f.boot.hydrate();
  await f.boot.server(member(2)); f.stop(); f.resolveDisk(); await pending;
  expect(f.retire).not.toHaveBeenCalled();
  expect(f.map.has(trainingKey("A", 1))).toBe(true);
  expect(f.map.get(draftKey("B", "profile:1"))).toBe("other private owner"); f.cache.clear();
});

it("blocks on cleanup failure, then retries without exposing prior-generation data", async () => {
  const f = fixture(member(1)); f.retire.mockRejectedValueOnce(Error("disk locked"));
  const pending = f.boot.hydrate(); f.resolveDisk(); await pending;
  await f.boot.server(member(2)); expect(f.boot.snapshot().status).toBe("blocked");
  await f.boot.retry(); expect(f.boot.snapshot()).toMatchObject({ status: "ready", enrollment: member(2) });
  expect(f.retire).toHaveBeenCalledTimes(2); f.cache.clear();
});

it("acknowledges foreground enrollment before retiring old scope; new profile draft survives profile failure", async () => {
  const f = fixture(member(2, false)); const loaded = f.boot.hydrate(); f.resolveDisk(); await loaded; await f.boot.server(member(2, false));
  const setup = f.boot.beginSetup(2);
  await f.boot.server(member(2)); // Foreground GET can beat the explicit enroll POST acknowledgement.
  expect(f.boot.snapshot().status).toBe("setup"); expect(f.retire).not.toHaveBeenCalled();
  const scope = await setup.acknowledge(member(2));
  await scope.drafts.save("A", "profile:2", { fresh: "new private draft" });
  await f.boot.server(member(2)); expect(f.retire).not.toHaveBeenCalled();
  await setup.fail();
  expect(f.boot.snapshot()).toMatchObject({ status: "ready", enrollment: member(2) });
  expect(await drafts(f.registry.capture("A")).load("A", "profile:2")).toEqual({ fresh: "new private draft" });
  f.cache.clear();
});

it("fails closed if an unrelated generation supersedes setup before acknowledgement", async () => {
  const f = fixture(member(2, false)); const loaded = f.boot.hydrate(); f.resolveDisk(); await loaded; await f.boot.server(member(2, false));
  const setup = f.boot.beginSetup(2); await f.boot.server(member(4));
  await expect(setup.acknowledge(member(2))).rejects.toThrow("enrollment changed");
  await setup.fail(); expect(f.boot.snapshot()).toMatchObject({ status: "ready", enrollment: member(4) }); f.cache.clear();
});

it("remote deletion during profile save retires the acknowledged draft and stops publication", async () => {
  const f = fixture(member(2, false)); const loaded = f.boot.hydrate(); f.resolveDisk(); await loaded; await f.boot.server(member(2, false));
  const setup = f.boot.beginSetup(2); const scope = await setup.acknowledge(member(2));
  await scope.drafts.save("A", "profile:2", { fresh: true });
  await f.boot.server(member(4, false));
  expect(() => scope.guard()).toThrow("enrollment changed");
  expect(() => setup.complete(member(2), "metric")).toThrow("enrollment changed");
  expect(f.map.has(draftKey("A", "profile:2"))).toBe(false);
  expect(f.boot.snapshot()).toMatchObject({ status: "ready", enrollment: member(4, false) }); f.cache.clear();
});

it("same-generation profile setup preserves existing actuals and completes once", async () => {
  const f = fixture(member(1)); const loaded = f.boot.hydrate(); f.resolveDisk(); await loaded; await f.boot.server(member(1));
  const setup = f.boot.beginSetup(1); await setup.acknowledge(member(1)); setup.complete(member(1), "metric");
  await f.boot.server(member(1)); expect(f.retire).not.toHaveBeenCalled();
  expect(f.map.has(trainingKey("A", 1))).toBe(true); f.cache.clear();
});

it("first setup restores verified owner mapping so offline cold startup resumes the same generation", async () => {
  const f = fixture(member(null, false)); const loaded = f.boot.hydrate(); f.resolveDisk(); await loaded; await f.boot.server(member(null, false));
  const setup = f.boot.beginSetup(null); const original = f.registry.capture("A");
  const profile = { ...initialProfile(), adult_confirmed: true };
  await saveTrainingSetup({ owner: "A", expected_generation: null, profile, drafts: drafts(original), setup,
    guard() { if (!original.isCurrent()) throw Error("original retired"); },
    api: { enroll: async () => member(1), profile: async () => null, profileRevision: () => 0,
      saveProfile: async () => profile, enrollment: async () => member(1) },
    complete: async (enrolled, saved) => {
      const scope = setup.scope();
      await commitTrainingSetup({ owner: "A", member: enrolled, profile: saved, expected_generation: null, units: "metric",
        draft_scope: "profile:new", drafts: scope.drafts, cache: f.cache, guardOriginal: scope.guard, guardOwner: setup.guard,
        cleanPrevious: () => f.retire(), freshDrafts() { const captured = f.registry.capture("A"); return { drafts: drafts(captured), isCurrent: captured.isCurrent }; },
        rememberGeneration() {}, ready(units, value) { setup.complete(value, units); },
      });
    },
  });
  expect(f.retire).toHaveBeenCalledOnce();
  expect(await f.identities.load(f.binding)).toEqual({ id: "A", binding: f.binding });
  expect(await drafts(f.registry.capture("A")).load("A", "enrollment")).toEqual(member(1));
  const prior = JSON.stringify({ version: 1, generation: 1, active: null, history: [] }); f.map.set(trainingKey("A", 1), prior);
  const cold = createTrainingStore(f.registry.capture("A"), (await f.identities.load(f.binding))!.id, 1); await cold.load();
  expect(cold.snapshot().generation).toBe(1); expect(f.cache.getQueryData(profileKey("A", 1))).toEqual(profile); f.cache.clear();
});

it("an identity write finishing after logout/deletion removes its stale mapping instead of restoring it", async () => {
  const map = new Map<string, string>(); const held = deferred<void>(); const started = deferred<void>(); let current = true;
  const identity = createVerifiedIdentityCache({ getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => { started.resolve(); await held.promise; map.set(key, value); },
    removeItem: async (key) => { map.delete(key); } });
  const saved = identity.save("binding", "A", () => current); await started.promise; current = false; held.resolve();
  await expect(saved).rejects.toThrow("identity changed"); expect(await identity.load("binding")).toBeNull();
});

it("unchanged foreground checks do not unmount active private training or retire its store", async () => {
  const f = fixture(member(1)); const loaded = f.boot.hydrate(); f.resolveDisk(); await loaded; await f.boot.server(member(1));
  const previous = f.states.length; await f.boot.server(member(1));
  expect(f.states.slice(previous)).toEqual([expect.objectContaining({ status: "ready", enrollment: member(1) })]);
  expect(f.retire).not.toHaveBeenCalled(); f.cache.clear();
});

it("units selection updates the bootstrap snapshot before a same-generation server refresh publishes it", async () => {
  const f = fixture(member(1)); const loaded = f.boot.hydrate(); f.resolveDisk(); await loaded; await f.boot.server(member(1));
  f.boot.units("imperial");
  expect(f.boot.snapshot().units).toBe("imperial");
  await f.boot.server(member(1));
  expect(f.boot.snapshot()).toMatchObject({ status: "ready", units: "imperial" });
  expect(f.states.at(-1)).toMatchObject({ status: "ready", units: "imperial" });
  expect(f.map.get(draftKey("A", "units"))).toBe('"imperial"');
  f.stop(); f.boot.units("metric");
  expect(f.boot.snapshot().units).toBe("imperial");
  f.cache.clear();
});

it("an older same-generation unenrolled response cannot undo acknowledged setup", async () => {
  const f = fixture(member(2, false)); const loaded = f.boot.hydrate(); f.resolveDisk(); await loaded; await f.boot.server(member(2, false));
  const setup = f.boot.beginSetup(2); await setup.acknowledge(member(2)); setup.complete(member(2), "metric");
  await f.boot.server(member(2, false));
  expect(f.boot.snapshot()).toMatchObject({ status: "ready", enrollment: member(2) });
  expect(f.retire).not.toHaveBeenCalled(); f.cache.clear();
});

it("replayed mount effects can bootstrap again without accepting a disposed disk read", async () => {
  const saved = member(1); const first = deferred<{ enrollment: Enrollment; units: "metric" }>();
  const second = deferred<{ enrollment: Enrollment; units: "imperial" }>();
  let calls = 0;
  const f = fixture(saved);
  const boot = createEnrollmentBootstrap({ owner: "A", isCurrent: () => true,
    load: () => ++calls === 1 ? first.promise : second.promise,
    retire: f.retire, clearQueries() {}, fresh() { const scope = f.registry.capture("A"); return { drafts: drafts(scope), isCurrent: scope.isCurrent }; },
    publish() {}, publishEnrollment() {},
  });
  boot.activate(); const retired = boot.hydrate(); boot.dispose(); boot.activate();
  const current = boot.hydrate(); await boot.server(saved);
  first.resolve({ enrollment: member(9), units: "metric" }); await retired;
  expect(boot.snapshot().status).toBe("pending");
  second.resolve({ enrollment: saved, units: "imperial" }); await current;
  expect(boot.snapshot()).toMatchObject({ status: "ready", enrollment: saved, units: "imperial" });
  expect(f.retire).not.toHaveBeenCalled(); f.cache.clear();
});

it.each([false, true])("foreground verification during an in-flight profile save preserves or stops acknowledged setup (deleted=%s)", async (deleted) => {
  const f = fixture(member(2, false)); const loaded = f.boot.hydrate(); f.resolveDisk(); await loaded; await f.boot.server(member(2, false));
  const setup = f.boot.beginSetup(2); const entered = deferred<void>(); const saved = deferred<ReturnType<typeof initialProfile>>();
  const profile = { ...initialProfile(), adult_confirmed: true }; const complete = vi.fn(async (enrolled, value) => { setup.complete(enrolled, "metric"); });
  const operation = saveTrainingSetup({ owner: "A", expected_generation: 2, profile, drafts: drafts(f.old), setup, guard() {},
    api: { enroll: async () => member(2), profile: async () => null, profileRevision: () => 0,
      saveProfile: async () => { entered.resolve(); return saved.promise; }, enrollment: async () => member(2) }, complete });
  const checked = operation.catch((error) => error);
  await entered.promise;
  await f.boot.server(deleted ? member(3, false) : member(2));
  expect(f.map.has(draftKey("A", "profile:2"))).toBe(!deleted);
  saved.resolve(profile); const result = await checked;
  if (deleted) { expect(result.message).toContain("enrollment changed"); expect(complete).not.toHaveBeenCalled(); }
  else { expect(result).toBeUndefined(); expect(complete).toHaveBeenCalledOnce(); }
  expect(f.boot.snapshot()).toMatchObject({ status: "ready", enrollment: deleted ? member(3, false) : member(2) }); f.cache.clear();
});

it("a queued fresh owner mapping survives the previous scope's late identity write", async () => {
  const map = new Map<string, string>(); const held = deferred<void>(); const entered = deferred<void>(); let oldCurrent = true, writes = 0;
  const identity = createVerifiedIdentityCache({ getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => { if (++writes === 1) { entered.resolve(); await held.promise; } map.set(key, value); },
    removeItem: async (key) => { map.delete(key); } });
  const old = identity.save("binding", "A", () => oldCurrent); const rejected = expect(old).rejects.toThrow("identity changed");
  await entered.promise; oldCurrent = false;
  const fresh = identity.save("binding", "B", () => true); held.resolve(); await rejected; await fresh;
  expect(await identity.load("binding")).toEqual({ id: "B", binding: "binding" });
});
