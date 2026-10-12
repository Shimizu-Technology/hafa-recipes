import { it, expect, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { activeTrainingGeneration, commitTrainingSetup, profileKey, saveTrainingSetup } from "./onboarding-state";
import { drafts, draftKey } from "./drafts";
import { createPrivateStorageRegistry } from "./private-storage";
import { createTrainingStore } from "./training";
import { initialProfile, type Enrollment } from "./models";
const profile = { ...initialProfile(), adult_confirmed: true, equipment: [] };
const enrollment = (generation: number | null, enrolled: boolean): Enrollment => ({
  generation,
  enrolled,
  adult_confirmed: enrolled,
  shared_account_deletion_acknowledged: enrolled,
  disclosure_version: 1,
  enrolled_at: enrolled ? "2026-10-10T00:00:00Z" : null,
});
function fixture(previous: number | null = null) {
  const map = new Map<string, string>();
  const raw = {
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: async (key: string) => {
      map.delete(key);
    },
    getAllKeys: async () => [...map.keys()],
  };
  const registry = createPrivateStorageRegistry(raw);
  const old = registry.capture("A");
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["A", "enrollment"], enrollment(previous, false));
  let owner = "A",
    remembered: number | null = null;
  return {
    map,
    registry,
    old,
    cache,
    setOwner: (value: string) => {
      owner = value;
    },
    remembered: () => remembered,
    bridge(member: Enrollment) {
      return {
        owner: "A",
        expected_generation: previous,
        member,
        profile,
        units: "imperial" as const,
        draft_scope: `profile:${previous ?? "new"}`,
        cache,
        drafts: drafts(old),
        guardOwner() {
          if (owner !== "A") throw Error("account changed");
        },
        guardOriginal() {
          if (owner !== "A" || !old.isCurrent()) throw Error("original state retired");
        },
        cleanPrevious: () => registry.erase("A"),
        freshDrafts() {
          const fresh = registry.capture("A");
          return { drafts: drafts(fresh), isCurrent: fresh.isCurrent };
        },
        rememberGeneration(value: number) {
          remembered = value;
        },
        ready: vi.fn(),
      };
    },
  };
}
it("publishes profile before enrollment so same-process Today and real Offline store activate immediately", async () => {
  const f = fixture();
  await drafts(f.old).save("A", "units", "metric");
  await drafts(f.old).save("A", "profile:new", profile);
  const member = enrollment(1, true);
  const profileObserver = new QueryObserver(f.cache, {
    queryKey: profileKey("A", 1),
    queryFn: async () => profile,
    enabled: false,
  });
  const unsubscribeProfile = profileObserver.subscribe(() => {});
  const observed: Array<{ generation: number | null; hasProfile: boolean }> = [];
  const memberObserver = new QueryObserver(f.cache, {
    queryKey: ["A", "enrollment"],
    queryFn: async () => member,
    enabled: false,
  });
  const stop = memberObserver.subscribe((result) => {
    if (result.data) {
      const generation = activeTrainingGeneration(result.data as Enrollment);
      observed.push({
        generation,
        hasProfile: generation != null && !!f.cache.getQueryData(profileKey("A", generation)),
      });
    }
  });
  const deps = f.bridge(member);
  const saveProfile = vi.fn(async () => profile);
  const checkEnrollment = vi.fn(async () => member);
  await saveTrainingSetup({
    owner: "A", profile, expected_generation: null, drafts: drafts(f.old),
    guard: deps.guardOriginal,
    api: {
      enroll: async () => member,
      profile: async () => null,
      profileRevision: () => 4,
      saveProfile,
      enrollment: checkEnrollment,
    },
    complete: (acknowledged, saved) => commitTrainingSetup({ ...deps, member: acknowledged, profile: saved }),
  });
  expect(saveProfile).toHaveBeenCalledWith(profile, 4, 1);
  expect(checkEnrollment).toHaveBeenCalledOnce();
  expect(observed).toContainEqual({ generation: 1, hasProfile: true });
  expect(profileObserver.getCurrentResult().data).toEqual(profile);
  expect(f.cache.getQueryData(["A", "profile:new"])).toBeUndefined();
  expect(f.remembered()).toBe(1);
  expect(deps.ready).toHaveBeenCalledWith("metric", member, true);
  expect(f.map.has(draftKey("A", "profile:new"))).toBe(false);
  expect(await drafts(f.registry.capture("A")).load("A", "units")).toBe("metric");
  const store = createTrainingStore(
    f.registry.capture("A"),
    "A",
    activeTrainingGeneration(f.cache.getQueryData<Enrollment>(["A", "enrollment"])!)!
  );
  await store.load();
  expect(store.snapshot().generation).toBe(1);
  await expect(f.old.setItem(draftKey("A", "profile:new"), "late")).rejects.toThrow("retired");
  stop();
  unsubscribeProfile();
  f.cache.clear();
});
it("retires old reenrollment state once, restores units and preserves another owner", async () => {
  const f = fixture(2);
  f.map.set("hafa-workouts:training:v1:A:1", "old");
  f.map.set(draftKey("B", "units"), '"imperial"');
  f.cache.setQueryData(["A", "profile", 2], { old: true });
  await drafts(f.old).save("A", "units", "metric");
  await commitTrainingSetup(f.bridge(enrollment(3, true)));
  expect(f.remembered()).toBe(3);
  expect(f.cache.getQueryData(["A", "profile", 3])).toEqual(profile);
  expect(f.cache.getQueryData(["A", "profile", 2])).toBeUndefined();
  expect(f.map.has("hafa-workouts:training:v1:A:1")).toBe(false);
  expect(f.map.get(draftKey("B", "units"))).toBe('"imperial"');
  f.cache.clear();
});
it("does not enable Today or publish a profile when save fails, preserving the generation-bound retry draft", async () => {
  const f = fixture();
  const complete = vi.fn();
  const api = {
    enroll: async () => enrollment(1, true),
    profile: async () => null,
    profileRevision: () => 0,
    saveProfile: async () => {
      throw Error("save failed");
    },
    enrollment: async () => enrollment(1, true),
  };
  await expect(
    saveTrainingSetup({
      owner: "A",
      profile,
      expected_generation: null,
      drafts: drafts(f.old),
      api,
      guard() {
        if (!f.old.isCurrent()) throw Error("retired");
      },
      complete,
    })
  ).rejects.toThrow("save failed");
  expect(complete).not.toHaveBeenCalled();
  expect(activeTrainingGeneration(f.cache.getQueryData<Enrollment>(["A", "enrollment"])!)).toBeNull();
  expect(await drafts(f.old).load("A", "profile:1")).toEqual(profile);
  f.cache.clear();
});
it("stops stale owner/retired device/deleted enrollment outcomes instead of publishing another setup", async () => {
  const f = fixture(2);
  f.setOwner("B");
  await expect(commitTrainingSetup(f.bridge(enrollment(3, true)))).rejects.toThrow("retired");
  expect(f.cache.getQueryData(["A", "enrollment"])).toEqual(enrollment(2, false));
  const second = fixture();
  const complete = vi.fn();
  await expect(
    saveTrainingSetup({
      owner: "A",
      profile,
      expected_generation: null,
      drafts: drafts(second.old),
      guard: () => {},
      api: {
        enroll: async () => enrollment(1, true),
        profile: async () => null,
        profileRevision: () => 0,
        saveProfile: async () => profile,
        enrollment: async () => enrollment(2, false),
      },
      complete,
    })
  ).rejects.toThrow("enrollment changed");
  expect(complete).not.toHaveBeenCalled();
  f.cache.clear();
  second.cache.clear();
});
it("does not erase live same-generation training while completing a missing profile", async () => {
  const f = fixture(1);
  f.cache.setQueryData(["A", "enrollment"], enrollment(1, true));
  f.map.set("hafa-workouts:training:v1:A:1", "existing actuals");
  const deps = f.bridge(enrollment(1, true));
  await commitTrainingSetup(deps);
  expect(f.old.isCurrent()).toBe(true);
  expect(f.map.get("hafa-workouts:training:v1:A:1")).toBe("existing actuals");
  expect(deps.ready).toHaveBeenCalledWith("imperial", enrollment(1, true), false);
  f.cache.clear();
});

it("keeps setup unpublished if cleanup fails or a newer tombstone arrives during cleanup", async () => {
  const f = fixture(2);
  const deps = f.bridge(enrollment(3, true));
  await expect(
    commitTrainingSetup({
      ...deps,
      cleanPrevious: async () => {
        throw Error("cleanup failed");
      },
    })
  ).rejects.toThrow("cleanup failed");
  expect(deps.ready).not.toHaveBeenCalled();
  expect(f.cache.getQueryData(["A", "profile", 3])).toBeUndefined();
  await expect(
    commitTrainingSetup({
      ...deps,
      cleanPrevious: async () => {
        await f.registry.erase("A");
        f.cache.setQueryData(["A", "enrollment"], enrollment(4, false));
      },
    })
  ).rejects.toThrow("enrollment changed");
  expect(f.cache.getQueryData(["A", "enrollment"])).toEqual(enrollment(4, false));
  expect(f.cache.getQueryData(["A", "profile", 3])).toBeUndefined();
  f.cache.clear();
});

it("stops after an await retires original storage, without sending profile or recreating private state", async () => {
  const f = fixture();
  const complete = vi.fn();
  const saveProfile = vi.fn(async () => profile);
  await expect(saveTrainingSetup({
    owner: "A", profile, expected_generation: null, drafts: drafts(f.old),
    guard() { if (!f.old.isCurrent()) throw Error("retired"); },
    api: {
      enroll: async () => enrollment(1, true),
      profile: async () => { await f.registry.erase("A"); return null; },
      profileRevision: () => 0,
      saveProfile,
      enrollment: async () => enrollment(1, true),
    },
    complete,
  })).rejects.toThrow("retired");
  expect(saveProfile).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
  expect(f.map.has(draftKey("A", "profile:1"))).toBe(false);
  expect(activeTrainingGeneration(f.cache.getQueryData<Enrollment>(["A", "enrollment"])!)).toBeNull();
  f.cache.clear();
});

it("real QueryClient delayed pre-setup enrollment cannot replace a freshly published active enrollment", async () => {
  const { createWorkoutsApi } = await import("./api");
  const f = fixture(2);
  let resolve!: (value: Response) => void;
  const held = new Promise<Response>((done) => { resolve = done; });
  const api = createWorkoutsApi("https://example.test", async () => "synthetic", vi.fn(async () => held));
  const old = f.cache.fetchQuery({ queryKey: ["A", "enrollment"], queryFn: ({ signal }) => api.enrollment({ signal }) });
  const settled = old.catch(() => undefined);
  await Promise.resolve();
  await commitTrainingSetup({ ...f.bridge(enrollment(3, true)), sealEnrollment: (value) => api.commitEnrollment(value) });
  resolve(new Response(JSON.stringify(enrollment(2, false))));
  await settled;
  await new Promise<void>((done) => setTimeout(done, 0));
  expect(f.cache.getQueryData(["A", "enrollment"])).toEqual(enrollment(3, true));
  expect(f.cache.getQueryData(profileKey("A", 3))).toEqual(profile);
  expect(api.generation()).toBe(3);
  f.cache.clear();
});
