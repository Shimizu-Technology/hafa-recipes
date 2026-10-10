import { createElement, type ComponentType } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialProfile, type Workout } from "./models";
import { draftKey } from "./drafts";
import type { Measurement } from "./measurements";
const fixture = vi.hoisted(() => ({
  map: new Map<string, string>(),
  owner: "owner-initial",
  run: 0,
  params: {} as { id?: string },
  revision: 1,
  saveWorkout: vi.fn(),
  saveProfile: vi.fn(),
  updateWorkout: vi.fn(),
  removeMeasurement: vi.fn(),
  saveMeasurement: vi.fn(),
  normalizeImages: vi.fn(),
  share: false,
  intent: { webUrl: "", text: "", files: [] as { path: string; mimeType: string; fileName: string }[] },
  resetIntent: vi.fn(),
  alert: vi.fn(),
  pickImages: vi.fn(),
  pickDocument: vi.fn(),
  cleanup: vi.fn(),
  sourceFor: vi.fn(),
  startImport: vi.fn(),
  setAiConsent: vi.fn(),
  current: true,
  next: 0,
  profile: vi.fn(),
  profileSnapshot: vi.fn(),
  workout: vi.fn(),
  measurement: vi.fn(),
  writeFailure: false
}));
vi.mock("@/lib/context", () => {
  const storage = {
    isCurrent: () => fixture.current,
    getItem: async (key: string) => fixture.map.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (fixture.writeFailure) throw Error("device write failed");
      fixture.map.set(key, value);
    }
  };
  const localDrafts = {
    load: async (owner: string, scope: string) => {
      const raw = await storage.getItem(`hafa-workouts:v1:${encodeURIComponent(owner)}:${encodeURIComponent(scope)}`);
      return raw ? JSON.parse(raw) : null;
    },
    save: async (owner: string, scope: string, value: unknown) =>
      storage.setItem(
        `hafa-workouts:v1:${encodeURIComponent(owner)}:${encodeURIComponent(scope)}`,
        JSON.stringify(value)
      )
  };
  const api = {
    capabilities: async () => ({ imports: true, limits: { successful_or_pending_imports_per_rolling_day: 3 } }),
    duplicateSources: async () => ({ matches: [] }),
    startImport: fixture.startImport,
    setAiConsent: fixture.setAiConsent,
    saveWorkout: fixture.saveWorkout,
    saveProfile: fixture.saveProfile,
    saveProfileSnapshot: async (...args: unknown[]) => {
      const returnedRevision = fixture.revision + 1;
      return { profile: await fixture.saveProfile(...args), revision: returnedRevision };
    },
    updateWorkout: fixture.updateWorkout,
    removeMeasurement: fixture.removeMeasurement,
    saveMeasurement: fixture.saveMeasurement,
    profile: fixture.profile,
    profileSnapshot: fixture.profileSnapshot,
    workout: fixture.workout,
    measurement: fixture.measurement,
    profileRevision: () => fixture.revision
  };
  return {
    useTraining: () => ({
      owner: fixture.owner,
      enrollment: { enrolled: true, generation: 1 },
      units: "metric",
      isCurrentAccount: () => fixture.current,
      storage,
      api,
      localDrafts: localDrafts
    })
  };
});
vi.mock("react-native", () => ({ View: "View", Image: "Image", Alert: { alert: fixture.alert } }));
vi.mock("@/components/source-image", () => ({ SourceImage: "SourceImage" }));
vi.mock("@/lib/capture-io", () => ({
  normalizeImages: fixture.normalizeImages,
  pickImages: fixture.pickImages,
  pickDocument: fixture.pickDocument,
  cleanupCaptureFiles: fixture.cleanup,
  sourceFor: fixture.sourceFor
}));
vi.mock("expo-router", () => ({
  router: { push: vi.fn(), replace: vi.fn() },
  useLocalSearchParams: () => fixture.params
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => `command-${++fixture.next}` }));
vi.mock("@/components/ui", () => ({
  Screen: "Screen",
  Card: "Card",
  Copy: "Copy",
  Field: "Field",
  Choice: "Choice",
  Notice: "Notice",
  Button: "Button",
  Empty: "Empty"
}));
vi.mock("@/components/query-state", () => ({ QueryState: "QueryState" }));
vi.mock("@/components/profile-form", () => ({ ProfileForm: "ProfileForm" }));
vi.mock("@/components/workout-editor", () => ({ WorkoutEditor: "WorkoutEditor" }));
vi.mock("@/components/recorded-time", () => ({ RecordedTime: "RecordedTime" }));
vi.mock("expo-share-intent", () => ({
  useShareIntentContext: () => ({
    hasShareIntent: fixture.share,
    shareIntent: fixture.intent,
    resetShareIntent: fixture.resetIntent
  })
}));
import { ShareCapture } from "../components/share-capture";
import Capture from "../app/capture";
import AddWorkout from "../app/add-workout";
import Profile from "../app/profile";
import EditWorkout from "../app/edit-workout/[id]";
import MeasurementEditor from "../app/measurement";
let renderer: ReactTestRenderer | undefined, cache: QueryClient;
const profile = { ...initialProfile(), adult_confirmed: true };
const workout: Workout = {
  id: "workout",
  generation: 1,
  revision: 1,
  title: "Original",
  kind: "session",
  provenance: "user",
  blocks: [{ id: "main", label: "Strength", grouping: "sequential", exercises: [{ name: "Row", sets: 2 }] }]
};
const entry: Measurement = {
  id: "m",
  generation: 1,
  revision: 1,
  kind: "weight",
  value: 75,
  unit: "kg",
  canonical_value: 75,
  canonical_unit: "kg",
  recorded_at: "2026-01-01T00:00:00Z",
  source: "user",
  is_current: false,
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z"
};
const removed: Measurement = {
  ...entry,
  revision: 2,
  value: null,
  unit: null,
  canonical_value: null,
  canonical_unit: null,
  recorded_at: null,
  status: "removed"
};
const nodes = (type: string) => renderer!.root.findAll((n) => String(n.type) === type);
const find = (type: string) => nodes(type)[0];
const button = (title: string) => nodes("Button").find((node) => node.props.title === title)!;
async function settle() {
  for (let i = 0; i < 4; i++)
    await act(async () => {
      await new Promise((done) => setTimeout(done, 5));
    });
}
async function mount(component: ComponentType) {
  await act(async () => {
    renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(component)));
  });
  await settle();
}
async function click(title: string) {
  await act(async () => {
    button(title).props.onPress();
  });
  await settle();
}
async function unmount() {
  await act(async () => renderer!.unmount());
  renderer = undefined;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.map.clear();
  fixture.owner = `owner-${++fixture.run}`;
  fixture.params = {};
  fixture.revision = 1;
  fixture.writeFailure = false;
  fixture.current = true;
  fixture.next = 0;
  fixture.share = false;
  fixture.intent = { webUrl: "", text: "", files: [] };
  for (const value of Object.values(fixture)) if (typeof value === "function") value.mockReset();
  fixture.profile.mockResolvedValue(profile);
  fixture.profileSnapshot.mockImplementation(async () => {
    const returnedRevision = fixture.revision;
    return { profile: await fixture.profile(), revision: returnedRevision };
  });
  fixture.cleanup.mockResolvedValue(undefined);
  fixture.setAiConsent.mockResolvedValue(undefined);
  fixture.sourceFor.mockImplementation(async (draft, guard) => {
    guard();
    return { kind: draft.kind, source_url: draft.source_url, ai_consent: true };
  });
  fixture.workout.mockResolvedValue(workout);
  fixture.measurement.mockResolvedValue(entry);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(async () => {
  if (renderer) await unmount();
  cache.clear();
});

it("mounted share replacement callback after retirement cleans its operation only and leaves newer shared intent untouched", async () => {
  fixture.share = true;
  fixture.intent = {
    webUrl: "",
    text: "",
    files: [{ path: "file:///user/original.jpg", mimeType: "image/jpeg", fileName: "User original" }]
  };
  const prior = {
    request_id: "prior",
    generation: 1,
    kind: "text",
    text: "Existing draft",
    source_url: "",
    files: [],
    created_at: "2026-01-01T00:00:00Z"
  };
  fixture.map.set(draftKey(fixture.owner, "capture:1"), JSON.stringify(prior));
  const files = [
    {
      uri: "file:///cache/hafa-workouts-capture/shared-operation.jpg",
      name: "Shared",
      mime_type: "image/jpeg",
      owned: true
    }
  ];
  fixture.normalizeImages.mockResolvedValueOnce(files);
  await mount(ShareCapture);
  expect(fixture.alert).toHaveBeenCalledTimes(1);
  const useShared = fixture.alert.mock.calls[0][2][1].onPress;
  fixture.current = false;
  await act(async () => useShared());
  await settle();
  expect(fixture.cleanup).toHaveBeenCalledWith(files, true);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "capture:1"))!)).toEqual(prior);
  expect(fixture.resetIntent).not.toHaveBeenCalled();
});

it("a newer mounted shared source proceeds while the superseded replacement callback stays fenced", async () => {
  fixture.share = true;
  fixture.intent = {
    webUrl: "",
    text: "",
    files: [{ path: "file:///user/old.jpg", mimeType: "image/jpeg", fileName: "Old" }]
  };
  fixture.map.set(
    draftKey(fixture.owner, "capture:1"),
    JSON.stringify({ request_id: "prior", generation: 1, text: "Prior", source_url: "", files: [] })
  );
  const oldFiles = [
    { uri: "file:///cache/hafa-workouts-capture/old-share.jpg", name: "Old", mime_type: "image/jpeg", owned: true }
  ];
  fixture.normalizeImages.mockResolvedValueOnce(oldFiles);
  await mount(ShareCapture);
  const oldAccept = fixture.alert.mock.calls[0][2][1].onPress;
  fixture.intent = { webUrl: "", text: "New shared source", files: [] };
  await act(async () => {
    renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(ShareCapture)));
  });
  await settle();
  const newAccept = fixture.alert.mock.calls[1][2][1].onPress;
  await act(async () => oldAccept());
  await settle();
  expect(fixture.resetIntent).not.toHaveBeenCalled();
  expect(fixture.cleanup).toHaveBeenCalledWith(oldFiles, true);
  await act(async () => newAccept());
  await settle();
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "capture:1"))!).text).toBe("New shared source");
  expect(fixture.resetIntent).toHaveBeenCalledTimes(1);
});

it("mounted capture cleans an exact late picker result after its owner retires, without registering or transmitting it", async () => {
  await mount(Capture);
  const choice = nodes("Choice").find((n) => n.props.label === "Photos or screenshots")!;
  await act(async () => choice.props.onPress());
  await settle();
  const pending = deferred<import("./capture").CaptureFile[]>();
  fixture.pickImages.mockReturnValue(pending.promise);
  await click("Choose up to four images");
  fixture.current = false;
  const late = [
    {
      uri: "file:///cache/hafa-workouts-capture/this-operation.jpg",
      mime_type: "image/jpeg",
      name: "Late",
      owned: true
    }
  ];
  await act(async () => pending.resolve(late));
  await settle();
  expect(fixture.cleanup).toHaveBeenCalledWith(late, true);
  expect([...fixture.map.values()].join()).not.toContain("this-operation.jpg");
  expect(fixture.startImport).not.toHaveBeenCalled();
});

it("mounted source import freezes its request UUID/source through lost acknowledgment and remount", async () => {
  await mount(Capture);
  await act(async () =>
    nodes("Field")
      .find((n) => n.props.label === "Source link")!
      .props.onChange("https://example.test/original")
  );
  const stale = nodes("Field").find((n) => n.props.label === "Source link")!.props.onChange;
  await act(async () =>
    nodes("Choice")
      .find((n) => n.props.label === "Use AI to extract this source")!
      .props.onPress()
  );
  fixture.startImport.mockRejectedValueOnce(Error("lost acknowledgment"));
  await click("Extract workout");
  await act(async () => stale("https://example.test/new-intent"));
  const original = fixture.startImport.mock.calls[0];
  await unmount();
  await mount(Capture);
  expect(nodes("Field")[0].props.value).toBe("https://example.test/original");
  await act(async () =>
    nodes("Choice")
      .find((n) => n.props.label === "Use AI to extract this source")!
      .props.onPress()
  );
  fixture.startImport.mockResolvedValueOnce({ id: "saved-import" });
  await click("Retry extracting this source");
  expect(fixture.startImport.mock.calls[1]).toEqual(original);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "capture:1"))!)).toMatchObject({
    pending_import: true,
    job_id: "saved-import"
  });
});

it("mounted source import checks owner retirement again after asynchronous consent before sending the source", async () => {
  await mount(Capture);
  await act(async () => nodes("Field")[0].props.onChange("https://example.test/original"));
  await act(async () =>
    nodes("Choice")
      .find((n) => n.props.label === "Use AI to extract this source")!
      .props.onPress()
  );
  const consent = deferred<void>();
  fixture.setAiConsent.mockReturnValueOnce(consent.promise);
  await click("Extract workout");
  fixture.current = false;
  await act(async () => consent.resolve());
  await settle();
  expect(fixture.startImport).not.toHaveBeenCalled();
});

it("mounted manual creation locks stale callbacks and replays identical body/key after lost acknowledgment and remount", async () => {
  await mount(AddWorkout);
  await act(async () => {
    nodes("Field")
      .find((n) => n.props.label === "Workout name")!
      .props.onChange("Original");
  });
  await act(async () => {
    nodes("Field")
      .find((n) => n.props.label === "Exercise name")!
      .props.onChange("Row");
  });
  const staleChange = nodes("Field").find((n) => n.props.label === "Workout name")!.props.onChange;
  const pending = deferred<Workout>();
  fixture.saveWorkout.mockReturnValueOnce(pending.promise);
  await click("Save to my library");
  const original = fixture.saveWorkout.mock.calls[0];
  expect(original[0].title).toBe("Original");
  expect(original[1]).toMatch(/^command-/);
  expect(original[2]).toBe(1);
  await act(async () => staleChange("Newer unwanted edit"));
  expect(fixture.map.get(draftKey(fixture.owner, "manual-workout:1"))).not.toContain("Newer unwanted edit");
  await act(async () => pending.reject(Error("lost acknowledgment")));
  await settle();
  await act(async () => staleChange("Late failed-save input"));
  expect(nodes("Field")[0].props.value).toBe("Original");
  await unmount();
  await mount(AddWorkout);
  expect(nodes("Field")[0].props.disabled).toBe(true);
  fixture.saveWorkout.mockRejectedValueOnce(Object.assign(Error("creation conflict"), { status: 409 }));
  await click("Retry saving workout");
  expect(fixture.saveWorkout.mock.calls[1]).toEqual(original);
  expect(button("Start another workout")).toBeDefined();
  fixture.saveWorkout.mockResolvedValueOnce(workout);
  await click("Retry saving workout");
  expect(fixture.saveWorkout.mock.calls[2]).toEqual(original);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "manual-workout:1"))!)).toMatchObject({
    terminal: true,
    input: null,
    command: null
  });
  await click("Start another workout");
  await click("Start another workout and discard this draft");
  await act(async () => nodes("Field")[0].props.onChange("Separate deliberate workout"));
  await act(async () =>
    nodes("Field")
      .find((n) => n.props.label === "Exercise name")!
      .props.onChange("Squat")
  );
  fixture.saveWorkout.mockResolvedValueOnce(workout);
  await click("Save to my library");
  expect(fixture.saveWorkout.mock.calls[3][1]).not.toBe(original[1]);
});

it("mounted form never transmits a command when its original local persistence fails", async () => {
  await mount(AddWorkout);
  await act(async () => {
    nodes("Field")[0].props.onChange("Original");
  });
  await act(async () => {
    nodes("Field")
      .find((n) => n.props.label === "Exercise name")!
      .props.onChange("Row");
  });
  await settle();
  fixture.writeFailure = true;
  await click("Save to my library");
  expect(fixture.saveWorkout).not.toHaveBeenCalled();
});

it("mounted profile retains the frozen revision and values across background refresh, failed fetch and remount", async () => {
  await mount(Profile);
  const desired = { ...profile, limitations: ["Original self-declared limit"] };
  await act(async () => find("ProfileForm").props.update(desired));
  const staleUpdate = find("ProfileForm").props.update,
    pending = deferred<typeof profile>();
  fixture.saveProfile.mockReturnValueOnce(pending.promise);
  await click("Save profile");
  fixture.revision = 9;
  await act(async () => {
    cache.setQueryData([fixture.owner, "profile", 1], { ...profile, limitations: ["Background replacement"] });
    staleUpdate({ ...profile, limitations: ["Newer edit"] });
  });
  expect(find("ProfileForm").props.value).toEqual(desired);
  expect(find("ProfileForm").props.disabled).toBe(true);
  await act(async () => pending.reject(Error("lost acknowledgment")));
  await settle();
  await unmount();
  fixture.profile.mockRejectedValue(Error("offline"));
  await mount(Profile);
  expect(find("ProfileForm").props.value).toEqual(desired);
  fixture.saveProfile.mockRejectedValueOnce(Object.assign(Error("revision conflict"), { status: 409 }));
  await click("Retry saving profile");
  expect(fixture.saveProfile.mock.calls[1]).toEqual([desired, 1, 1]);
  fixture.profile.mockResolvedValue({ ...profile, limitations: ["Latest saved"] });
  await click("Reload saved profile and discard this draft");
  expect(find("ProfileForm").props.value.limitations).toEqual(["Latest saved"]);
  expect(fixture.saveProfile).toHaveBeenCalledTimes(2);
});

it("mounted workout editing preserves original content/revision across background query updates and lost acknowledgment", async () => {
  fixture.params = { id: "workout" };
  await mount(EditWorkout);
  await act(async () => find("WorkoutEditor").props.onChange({ ...workout, title: "Desired correction" }));
  const pending = deferred<Workout>();
  fixture.updateWorkout.mockReturnValueOnce(pending.promise);
  await click("Save new workout version");
  const original = fixture.updateWorkout.mock.calls[0][0];
  await act(async () => {
    cache.setQueryData([fixture.owner, "workout", "workout", 1], { ...workout, revision: 8, title: "Background" });
  });
  expect(find("WorkoutEditor").props.value.title).toBe("Desired correction");
  await act(async () => pending.reject(Error("lost acknowledgment")));
  await settle();
  await unmount();
  await mount(EditWorkout);
  fixture.updateWorkout.mockResolvedValue({ ...original, revision: 2 });
  await click("Retry saving changes");
  expect(fixture.updateWorkout.mock.calls[1][0]).toEqual(original);
  expect(original.revision).toBe(1);
  fixture.workout.mockResolvedValue({ ...original, revision: 2 });
  await unmount();
  cache.clear();
  await mount(EditWorkout);
  expect(find("WorkoutEditor").props.disabled).toBe(true);
  expect(button("Reload saved workout and discard this draft")).toBeDefined();
});

it("mounted completed profile recovers its saved read-only view after remount and requires deliberate editing", async () => {
  await mount(Profile);
  fixture.saveProfile.mockResolvedValue(profile);
  await click("Save profile");
  await unmount();
  cache.clear();
  await mount(Profile);
  expect(find("ProfileForm").props.disabled).toBe(true);
  await click("Edit these saved preferences");
  expect(find("ProfileForm").props.disabled).toBe(false);
  expect(fixture.saveProfile).toHaveBeenCalledTimes(1);
});

it("mounted remote tombstone retires sensitive measurement draft and fences a stale input callback", async () => {
  fixture.params = { id: "m" };
  await mount(MeasurementEditor);
  await act(async () => find("Field").props.onChange("76.125"));
  await settle();
  const staleChange = find("Field").props.onChange;
  await act(async () => {
    cache.setQueryData([fixture.owner, "measurement", "m", 1], removed);
  });
  await settle();
  await act(async () => staleChange("79.999"));
  await settle();
  const stored = fixture.map.get(draftKey(fixture.owner, "measurement:m:1"))!;
  expect(JSON.parse(stored)).toMatchObject({ removed: true, input: null, command: null });
  expect(stored).not.toContain("76.125");
  expect(stored).not.toContain("79.999");
  expect(stored).not.toContain(entry.recorded_at);
  expect(nodes("Field")).toHaveLength(0);
});

it("mounted acknowledged removal retains its tombstone when all subsequent reads fail and after remount", async () => {
  fixture.params = { id: "m" };
  await mount(MeasurementEditor);
  fixture.removeMeasurement.mockResolvedValue({
    measurement: removed,
    profile_revision: 2,
    current_applied: false,
    profile,
    context_reset: true
  });
  fixture.measurement.mockRejectedValue(Error("offline"));
  fixture.profileSnapshot.mockRejectedValue(Error("offline"));
  await click("Remove this measurement");
  await click("Remove measurement and clear affected saved context");
  expect(cache.getQueryData([fixture.owner, "measurement", "m", 1])).toEqual(removed);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "measurement:m:1"))!).removed).toBe(true);
  await unmount();
  await mount(MeasurementEditor);
  expect(nodes("Field")).toHaveLength(0);
  expect(fixture.removeMeasurement).toHaveBeenCalledTimes(1);
});

it("mounted removed measurement offers a finite device-cleanup retry after a local disk write failure", async () => {
  fixture.params = { id: "m" };
  await mount(MeasurementEditor);
  fixture.writeFailure = true;
  await act(async () => {
    cache.setQueryData([fixture.owner, "measurement", "m", 1], removed);
  });
  await settle();
  expect(nodes("Field")).toHaveLength(0);
  expect(button("Retry removed measurement device cleanup")).toBeDefined();
  fixture.writeFailure = false;
  await click("Retry removed measurement device cleanup");
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "measurement:m:1"))!)).toMatchObject({
    removed: true,
    input: null,
    command: null
  });
  expect(nodes("Button").some((n) => n.props.title === "Retry removed measurement device cleanup")).toBe(false);
});
it("mounted removal ACK fences input before failed persistence/refetch and offers cleanup retry without replaying deletion", async () => {
  fixture.params = { id: "m" };
  await mount(MeasurementEditor);
  await act(async () => find("Field").props.onChange("76.125"));
  await settle();
  const staleChange = find("Field").props.onChange,
    pending = deferred<unknown>();
  fixture.removeMeasurement.mockReturnValueOnce(pending.promise);
  await click("Remove this measurement");
  await click("Remove measurement and clear affected saved context");
  expect(fixture.removeMeasurement).toHaveBeenCalledTimes(1);
  fixture.writeFailure = true;
  fixture.measurement.mockRejectedValue(Error("offline"));
  fixture.profileSnapshot.mockRejectedValue(Error("offline"));
  await act(async () =>
    pending.resolve({ measurement: removed, profile_revision: 2, current_applied: false, profile, context_reset: true })
  );
  await settle();
  await act(async () => staleChange("79.999"));
  await settle();
  expect(cache.getQueryData([fixture.owner, "measurement", "m", 1])).toEqual(removed);
  expect(nodes("Field")).toHaveLength(0);
  expect(nodes("RecordedTime")).toHaveLength(0);
  expect(
    nodes("Copy")
      .flatMap((n) => n.children)
      .join()
  ).not.toContain("76.125");
  expect(button("Retry removed measurement device cleanup")).toBeDefined();
  await unmount();
  await mount(MeasurementEditor);
  expect(nodes("Field")).toHaveLength(0);
  expect(button("Retry removed measurement device cleanup")).toBeDefined();
  fixture.writeFailure = false;
  await click("Retry removed measurement device cleanup");
  const stored = fixture.map.get(draftKey(fixture.owner, "measurement:m:1"))!;
  expect(JSON.parse(stored)).toMatchObject({ removed: true, input: null, command: null });
  expect(stored).not.toContain("76.125");
  expect(stored).not.toContain("79.999");
  expect(stored).not.toContain(entry.recorded_at);
  expect(fixture.removeMeasurement).toHaveBeenCalledTimes(1);
});

it("cold restart after removal ACK/device retirement failure recovers no private input and retries the original removal offline", async () => {
  fixture.params = { id: "m" };
  await mount(MeasurementEditor);
  await act(async () => find("Field").props.onChange("76.125"));
  await settle();
  const pending = deferred<unknown>();
  fixture.removeMeasurement.mockReturnValueOnce(pending.promise);
  await click("Remove this measurement");
  const staleRemove = button("Remove measurement and clear affected saved context").props.onPress;
  await click("Remove measurement and clear affected saved context");
  await act(async () => staleRemove());
  expect(fixture.next).toBe(1);
  const original = fixture.removeMeasurement.mock.calls[0];
  const key = draftKey(fixture.owner, "measurement:m:1");
  const storedPending = JSON.parse(fixture.map.get(key)!);
  expect(storedPending.input).toBeNull();
  expect(storedPending.command).toEqual({
    kind: "remove",
    profile_revision: 1,
    generation: 1,
    body: { request_id: original[1], expected_revision: 1 }
  });
  expect(fixture.map.get(key)).not.toContain("76.125");
  expect(fixture.map.get(key)).not.toContain(entry.recorded_at);
  expect(nodes("Field")).toHaveLength(0);
  expect(nodes("RecordedTime")).toHaveLength(0);
  fixture.writeFailure = true;
  fixture.measurement.mockRejectedValue(Error("offline"));
  fixture.profileSnapshot.mockRejectedValue(Error("offline"));
  await act(async () =>
    pending.resolve({ measurement: removed, profile_revision: 2, current_applied: false, profile, context_reset: true })
  );
  await settle();
  expect(button("Retry removed measurement device cleanup")).toBeDefined();
  await unmount();
  cache.clear();
  vi.resetModules();
  const { default: RestartedMeasurement } = await import("../app/measurement");
  await mount(RestartedMeasurement);
  expect(nodes("Field")).toHaveLength(0);
  expect(nodes("RecordedTime")).toHaveLength(0);
  expect(fixture.map.get(key)).not.toContain("76.125");
  expect(fixture.map.get(key)).not.toContain(entry.recorded_at);
  expect(button("Retry this measurement removal")).toBeDefined();
  expect(nodes("QueryState")[0].props.error.message).toBe("offline");
  expect(
    nodes("QueryState")[0].findAll(
      (n) => String(n.type) === "Button" && n.props.title === "Retry this measurement removal"
    )
  ).toHaveLength(0);
  fixture.writeFailure = false;
  fixture.removeMeasurement.mockResolvedValue({
    measurement: removed,
    profile_revision: 2,
    current_applied: false,
    profile,
    context_reset: true
  });
  await click("Retry this measurement removal");
  expect(fixture.removeMeasurement.mock.calls[1]).toEqual(original);
  expect(fixture.next).toBe(1);
  expect(JSON.parse(fixture.map.get(key)!)).toMatchObject({ input: null, command: null, removed: true });
  await unmount();
  cache.clear();
  vi.resetModules();
  const { default: CompletedMeasurement } = await import("../app/measurement");
  await mount(CompletedMeasurement);
  expect(nodes("Field")).toHaveLength(0);
  expect(nodes("Button").some((n) => n.props.title === "Retry this measurement removal")).toBe(false);
  expect(fixture.removeMeasurement).toHaveBeenCalledTimes(2);
});
it.each(["raw", "version1"])(
  "legacy %s pending removal hides and scrubs private values before any retry while offline",
  async (format) => {
    fixture.params = { id: "m" };
    fixture.measurement.mockRejectedValue(Error("offline"));
    fixture.profileSnapshot.mockRejectedValue(Error("offline"));
    const command = {
      kind: "remove",
      profile_revision: 4,
      generation: 1,
      body: { request_id: "legacy-removal", expected_revision: 3 }
    };
    const input = { generation: 1, value: "PRIVATE_VALUE", recorded_at: "PRIVATE_DATE", operation: command };
    const key = draftKey(fixture.owner, "measurement:m:1");
    fixture.map.set(
      key,
      JSON.stringify(format === "raw" ? input : { version: 1, input, command, terminal: false, removed: false })
    );
    fixture.writeFailure = true;
    await mount(MeasurementEditor);
    expect(nodes("Field")).toHaveLength(0);
    expect(nodes("RecordedTime")).toHaveLength(0);
    await click("Retry this measurement removal");
    expect(fixture.removeMeasurement).not.toHaveBeenCalled();
    fixture.writeFailure = false;
    fixture.removeMeasurement.mockImplementationOnce(async (...args) => {
      expect(fixture.map.get(key)).not.toContain("PRIVATE");
      expect(JSON.parse(fixture.map.get(key)!).input).toBeNull();
      expect(args).toEqual(["m", "legacy-removal", 3, 4, 1]);
      throw Error("offline transport");
    });
    await click("Retry this measurement removal");
    expect(fixture.removeMeasurement).toHaveBeenCalledTimes(1);
    expect(fixture.next).toBe(0);
    expect(JSON.parse(fixture.map.get(key)!)).toMatchObject({ input: null, command });
  }
);

it.each([409, 428])(
  "a pending removal conflict %s requires explicit discard and a separate new removal with current revisions",
  async (status) => {
    fixture.params = { id: "m" };
    await mount(MeasurementEditor);
    fixture.removeMeasurement.mockRejectedValueOnce(Object.assign(Error("saved context changed"), { status }));
    await click("Remove this measurement");
    await click("Remove measurement and clear affected saved context");
    const original = fixture.removeMeasurement.mock.calls[0];
    const key = draftKey(fixture.owner, "measurement:m:1");
    expect(JSON.parse(fixture.map.get(key)!)).toMatchObject({
      input: null,
      command: { body: { request_id: original[1] } }
    });
    expect(nodes("Field")).toHaveLength(0);
    expect(button("Reload saved measurement and discard this removal")).toBeDefined();
    const latest = { ...entry, revision: 5, value: 80.25, recorded_at: "2026-02-02T10:30:00Z", is_current: true };
    fixture.measurement.mockResolvedValueOnce(latest);
    fixture.profileSnapshot.mockResolvedValueOnce({ revision: 7, profile });
    await click("Reload saved measurement and discard this removal");
    expect(fixture.measurement).toHaveBeenLastCalledWith("m", 1);
    expect(nodes("Field")[0].props.value).toBe("80.25");
    expect(nodes("Field")[0].props.disabled).toBe(false);
    expect(nodes("RecordedTime")[0].props.value).toBe(latest.recorded_at);
    expect(JSON.parse(fixture.map.get(key)!)).toMatchObject({
      command: null,
      terminal: false,
      input: { value: "80.25", measurement_revision: 5, profile_revision: 7, recorded_at: latest.recorded_at }
    });
    expect(fixture.removeMeasurement).toHaveBeenCalledTimes(1);
    expect(fixture.next).toBe(1);
    expect(nodes("Button").some((n) => n.props.title === "Retry this measurement removal")).toBe(false);
    fixture.removeMeasurement.mockRejectedValueOnce(Error("lost acknowledgment"));
    await click("Remove this measurement");
    await click("Remove measurement and clear affected saved context");
    expect(fixture.removeMeasurement.mock.calls[1]).toEqual(["m", "command-2", 5, 7, 1]);
    expect(fixture.removeMeasurement.mock.calls[1][1]).not.toBe(original[1]);
    expect(JSON.parse(fixture.map.get(key)!).input).toBeNull();
  }
);
it("conflicted removal inspection seals an existing tombstone before failed device cleanup and never reads the failing profile", async () => {
  fixture.params = { id: "m" };
  await mount(MeasurementEditor);
  await act(async () => find("Field").props.onChange("76.125"));
  await settle();
  const staleChange = find("Field").props.onChange;
  fixture.removeMeasurement.mockRejectedValueOnce(Object.assign(Error("profile conflict"), { status: 409 }));
  await click("Remove this measurement");
  await click("Remove measurement and clear affected saved context");
  const original = fixture.removeMeasurement.mock.calls[0];
  const key = draftKey(fixture.owner, "measurement:m:1");
  fixture.writeFailure = true;
  fixture.measurement.mockResolvedValueOnce(removed);
  fixture.profileSnapshot.mockRejectedValue(Error("profile offline"));
  const profileReads = fixture.profileSnapshot.mock.calls.length;
  await click("Reload saved measurement and discard this removal");
  expect(cache.getQueryData([fixture.owner, "measurement", "m", 1])).toEqual(removed);
  expect(fixture.profileSnapshot).toHaveBeenCalledTimes(profileReads);
  expect(nodes("Field")).toHaveLength(0);
  expect(nodes("RecordedTime")).toHaveLength(0);
  expect(button("Retry removed measurement device cleanup")).toBeDefined();
  expect(nodes("Button").some((n) => n.props.title === "Retry this measurement removal")).toBe(false);
  await act(async () => staleChange("79.999"));
  await settle();
  const pending = JSON.parse(fixture.map.get(key)!);
  expect(pending).toMatchObject({ input: null, command: { body: { request_id: original[1] } } });
  expect(fixture.map.get(key)).not.toContain("76.125");
  expect(fixture.map.get(key)).not.toContain("79.999");
  expect(fixture.map.get(key)).not.toContain(entry.recorded_at);
  expect(fixture.removeMeasurement).toHaveBeenCalledTimes(1);
  expect(fixture.next).toBe(1);
  fixture.writeFailure = false;
  await click("Retry removed measurement device cleanup");
  expect(JSON.parse(fixture.map.get(key)!)).toMatchObject({ removed: true, input: null, command: null });
});
