import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWorkoutsApi, type ProfileSnapshot } from "./api";
import { draftKey } from "./drafts";
import { initialProfile, type TrainingProfile } from "./models";

const f = vi.hoisted(() => ({
  owner: "", run: 0, current: true,
  api: null as ReturnType<typeof createWorkoutsApi> | null,
  map: new Map<string, string>(),
  write: null as null | ((value: { terminal: boolean; input: unknown; command: unknown }) => Promise<void>)
}));
vi.mock("@/lib/context", () => {
  const storage = {
    isCurrent: () => f.current,
    getItem: async (key: string) => f.map.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (f.write) await f.write(JSON.parse(value));
      f.map.set(key, value);
    },
    removeItem: async (key: string) => { f.map.delete(key); }
  };
  return { useTraining: () => ({
    owner: f.owner, enrollment: { enrolled: true, generation: 1 }, api: f.api,
    isCurrentAccount: () => f.current, storage
  }) };
});
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/components/ui", () => ({ Screen: "Screen", Button: "Button", Notice: "Notice", Empty: "Empty" }));
vi.mock("@/components/query-state", () => ({ QueryState: "QueryState" }));
vi.mock("@/components/profile-form", () => ({ ProfileForm: "ProfileForm" }));
import Profile from "../app/profile";

const original: TrainingProfile = { ...initialProfile(), adult_confirmed: true, limitations: ["Original"] };
let renderer: ReactTestRenderer | undefined, cache: QueryClient;
let server: ProfileSnapshot<TrainingProfile>;
let puts: Array<{ profile: TrainingProfile; revision: number; generation: string | undefined }>;
let failBeforeCommit: boolean, loseCommittedAck: boolean;
let wirePuts: Array<{ body: string; ifMatch: string; generation: string }>;
let measurementUpdate: ProfileSnapshot<TrainingProfile> | null;
const key = () => [f.owner, "profile", 1, "snapshot"];
const legacyKey = () => [f.owner, "profile", 1];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const node = (type: string) => renderer!.root.findAll((entry) => String(entry.type) === type)[0];
const button = (title: string) => renderer!.root.findAll((entry) => String(entry.type) === "Button")
  .find((entry) => entry.props.title === title)!;
async function settle() {
  for (let index = 0; index < 4; index++) await act(async () => {
    await new Promise((done) => setTimeout(done, 5));
  });
}
async function mount() {
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(Profile))); });
  await settle();
}
async function click(title: string) {
  await act(async () => { button(title).props.onPress(); });
  await settle();
}
async function unmount() {
  await act(async () => { renderer!.unmount(); }); renderer = undefined;
}
async function background(profile: TrainingProfile, revision: number, publish = true) {
  server = { profile, revision };
  const snapshot = await f.api!.profileSnapshot();
  if (publish) await act(async () => {
    cache.setQueryData(key(), snapshot);
    cache.setQueryData(legacyKey(), snapshot.profile);
  });
  await settle();
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f.owner = `paired-profile-owner-${++f.run}`; f.current = true; f.map.clear(); f.write = null;
  server = { profile: original, revision: 1 }; puts = []; failBeforeCommit = false; loseCommittedAck = false; wirePuts = []; measurementUpdate = null;
  const transport = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
    if (String(url).includes("/measurements") && measurementUpdate) {
      server = measurementUpdate;
      return new Response(JSON.stringify({ profile: server.profile, profile_revision: server.revision, current_applied: true, context_reset: false, measurement: { id: "m", generation: 1, revision: 2 } }));
    }
    if (options?.method === "PUT") {
      const headers = options.headers as Record<string, string>;
      const sent = { profile: JSON.parse(options.body as string), revision: Number(headers["If-Match"].replaceAll('"', "")), generation: headers["X-Workouts-Generation"] };
      puts.push(sent);
      wirePuts.push({ body: options.body as string, ifMatch: headers["If-Match"], generation: headers["X-Workouts-Generation"] });
      if (failBeforeCommit) { failBeforeCommit = false; throw Error("Transport failed before commit"); }
      if (sent.revision !== server.revision) return new Response("private conflict", { status: 409 });
      server = { profile: sent.profile, revision: server.revision + 1 };
      if (loseCommittedAck) { loseCommittedAck = false; throw Error("Network acknowledgement lost after commit"); }
    }
    return new Response(JSON.stringify(server.profile), { headers: { "X-Workouts-Revision": String(server.revision) } });
  });
  f.api = createWorkoutsApi("https://example.test", async () => "synthetic", transport);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  cache.setQueryData(key(), { profile: original, revision: 1 });
  cache.setQueryData(legacyKey(), original);
});
afterEach(async () => { if (renderer) await unmount(); cache.clear(); });

it("does not pair an older cached profile with a revision advanced by another API reader", async () => {
  const newer = { ...original, limitations: ["Different reader"] };
  await background(newer, 7, false); // Global metadata7, both screen caches still original1.
  await mount();
  const desired = { ...original, primary_goal: "strength" as const };
  await act(async () => { node("ProfileForm").props.update(desired); });
  await click("Save profile");
  expect(puts).toEqual([{ profile: desired, revision: 1, generation: "1" }]);
  expect(server).toEqual({ profile: newer, revision: 7 });
  expect(node("ProfileForm").props.value).toEqual(desired);
});

it("retries the original paired command after pre-commit transport failure, refresh and remount", async () => {
  await mount();
  const desired = { ...original, primary_goal: "running" as const };
  await act(async () => { node("ProfileForm").props.update(desired); });
  failBeforeCommit = true;
  await click("Save profile");
  await background({ ...original, limitations: ["Changed elsewhere"] }, 5);
  await unmount(); await mount();
  await click("Retry saving profile");
  expect(puts).toEqual([
    { profile: desired, revision: 1, generation: "1" },
    { profile: desired, revision: 1, generation: "1" }
  ]);
  expect(node("ProfileForm").props.value).toEqual(desired);
});

it("keeps the PUT's paired acknowledgement while completion persistence awaits another snapshot", async () => {
  await mount();
  const gate = deferred(); let completing = false;
  f.write = async (box) => { if (box.terminal) { completing = true; await gate.promise; } };
  const desired = { ...original, primary_goal: "strength" as const };
  await act(async () => { node("ProfileForm").props.update(desired); });
  await click("Save profile");
  expect(completing).toBe(true);
  await background({ ...original, limitations: ["Newer than acknowledgement"] }, 9);
  gate.resolve(); await settle();
  expect(node("ProfileForm").props.value).toEqual(desired);
  expect(cache.getQueryData<ProfileSnapshot>(key())?.revision).toBe(9);
  expect(cache.getQueryData<TrainingProfile>(legacyKey())?.limitations).toEqual(["Newer than acknowledgement"]);
  f.write = null;
  await click("Edit these saved preferences");
  await act(async () => { node("ProfileForm").props.update({ ...desired, experience: "regular" }); });
  await click("Save profile");
  expect(puts[1].revision).toBe(2); // ACK2, never unrelated mutable global9.
  expect(server.revision).toBe(9);
});

it("reloads the GET's own profile/revision pair even when reset awaits a newer snapshot", async () => {
  await mount(); failBeforeCommit = true; await click("Save profile");
  await background({ ...original, limitations: ["Reload response"] }, 5);
  const gate = deferred(); let resetting = false;
  f.write = async (box) => { if (!box.terminal && box.input === null) { resetting = true; await gate.promise; } };
  await click("Reload saved profile and discard this draft");
  expect(resetting).toBe(true);
  await background({ ...original, limitations: ["Later background"] }, 9);
  gate.resolve(); await settle(); f.write = null;
  expect(node("ProfileForm").props.value.limitations).toEqual(["Reload response"]);
  const box = JSON.parse(f.map.get(draftKey(f.owner, "profile-edit:1"))!);
  expect(box.input.revision).toBe(5);
  expect(cache.getQueryData<ProfileSnapshot>(key())?.revision).toBe(9);
  await click("Save profile");
  expect(puts[1].revision).toBe(5);
  expect(puts[1].profile.limitations).toEqual(["Reload response"]);
  expect(server.revision).toBe(9);
});


it.each(["save", "remove"])("keeps the cached pair when a measurement %s advances mutable metadata", async (operation) => {
  const newer = { ...original, weight_kg: operation === "save" ? 80 : null, limitations: ["Measurement writer"] };
  measurementUpdate = { profile: newer, revision: 9 };
  if (operation === "save") await f.api!.saveMeasurement(null, {
    request_id: "measurement-save", kind: "weight", value: 80, unit: "kg",
    recorded_at: "2026-10-10T00:00:00Z", source: "user", update_current: true
  }, 1, 1);
  else await f.api!.removeMeasurement("m", "measurement-remove", 1, 1, 1);
  cache.setQueryData(legacyKey(), newer); // Existing measurement publisher keeps this raw shape.
  expect(f.api!.profileRevision()).toBe(9);
  await mount();
  await click("Save profile");
  expect(puts[0]).toEqual({ profile: original, revision: 1, generation: "1" });
  expect(server).toEqual(measurementUpdate);
  expect(cache.getQueryData(legacyKey())).toEqual(newer);
});


it("recovers a committed PUT with lost acknowledgement only through explicit paired reload", async () => {
  await mount();
  const desired = { ...original, primary_goal: "strength" as const };
  await act(async () => { node("ProfileForm").props.update(desired); });
  loseCommittedAck = true;
  await click("Save profile");
  expect(server).toEqual({ profile: desired, revision: 2 });
  expect(puts).toHaveLength(1);
  const pending = JSON.parse(f.map.get(draftKey(f.owner, "profile-edit:1"))!);
  expect(pending.command).toEqual({ value: desired, revision: 1, generation: 1 });
  expect(pending.terminal).toBe(false);

  await unmount(); await mount();
  expect(puts).toHaveLength(1); // Remount never resends automatically.
  await click("Retry saving profile");
  expect(wirePuts).toEqual([wirePuts[0], wirePuts[0]]);
  expect(wirePuts[1].ifMatch).toBe('"1"');
  expect(wirePuts[1].generation).toBe("1");
  expect(server).toEqual({ profile: desired, revision: 2 }); // Retry409, no second commit.
  expect(renderer!.root.findAll((entry) => String(entry.type) === "Notice")
    .some((entry) => typeof entry.props.children === "string" && entry.props.children.includes("changed elsewhere"))).toBe(true);
  const conflicted = JSON.parse(f.map.get(draftKey(f.owner, "profile-edit:1"))!);
  expect(conflicted.command.revision).toBe(1);
  expect(node("ProfileForm").props.disabled).toBe(true);

  await click("Reload saved profile and discard this draft");
  expect(cache.getQueryData(key())).toEqual({ profile: desired, revision: 2 });
  expect(node("ProfileForm").props.value).toEqual(desired);
  expect(node("ProfileForm").props.disabled).toBe(false);
  expect(button("Retry saving profile")).toBeUndefined();
  const reloaded = JSON.parse(f.map.get(draftKey(f.owner, "profile-edit:1"))!);
  expect(reloaded.command).toBeNull();
  expect(reloaded.input).toEqual({ value: desired, revision: 2, generation: 1 });
  expect(wirePuts).toHaveLength(2); // Paired reload is a GET/reset, never an extra PUT.
});
