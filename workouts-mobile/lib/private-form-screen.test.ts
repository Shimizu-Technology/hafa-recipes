import { createElement, Fragment, Suspense, startTransition, useLayoutEffect, useState, type ComponentType } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialProfile, type AuthoredWorkout, type Workout } from "./models";
import { ApiError } from "./api";
import { draftKey } from "./drafts";
import { createPrivateForm } from "./private-form";
import { workoutErrors } from "./library";
import { submittedCaptureScope } from "./capture";
import type { Measurement } from "./measurements";
const fixture = vi.hoisted(() => ({
  map: new Map<string, string>(),
  owner: "owner-initial",
  run: 0,
  params: {} as { id?: string; shared?: string; request_id?: string; auto?: string },
  revision: 1,
  generation: 1,
  saveWorkout: vi.fn(),
  persist: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  dismissTo: vi.fn(),
  importJob: vi.fn(),
  cancelImport: vi.fn(),
  acceptImport: vi.fn(),
  importSource: vi.fn(),
  saveProfile: vi.fn(),
  updateWorkout: vi.fn(),
  removeMeasurement: vi.fn(),
  saveMeasurement: vi.fn(),
  normalizeImages: vi.fn(),
  normalizeDocument: vi.fn(),
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
  aiConsent: vi.fn(),
  capabilities: vi.fn(), publishingDisclosure: vi.fn(), acceptPublishingDisclosure: vi.fn(), nativePreference: vi.fn(),
  publishingRequired: false, publishingAgreed: true,
  current: true,
  next: 0,
  profile: vi.fn(),
  profileSnapshot: vi.fn(),
  workout: vi.fn(),
  measurement: vi.fn(),
  writeFailure: false,
  readFailure: false,
  removeFailureScope: "",
  foreground: new Set<(state: string) => void>(),
  os: "android", nativeSharing: false, nativeCaptures: vi.fn(), nativeAck: vi.fn()
}));
vi.mock("@/lib/context", () => {
  const storage = {
    isCurrent: () => fixture.current,
    removeItem: async (key: string) => {
      if (fixture.removeFailureScope && key === draftKey(fixture.owner, fixture.removeFailureScope)) throw Error("device cleanup failed");
      fixture.map.delete(key);
    },
    getItem: async (key: string) => {
      if (fixture.readFailure) throw Error("device read failed");
      return fixture.map.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      if (fixture.writeFailure) throw Error("device write failed");
      await fixture.persist(key, value);
    }
  };
  const localDrafts = {
    load: async (owner: string, scope: string) => {
      const raw = await storage.getItem(`hafa-workouts:v1:${encodeURIComponent(owner)}:${encodeURIComponent(scope)}`);
      return raw ? JSON.parse(raw) : null;
    },
    remove: async (owner: string, scope: string) => storage.removeItem(draftKey(owner, scope)),
    save: async (owner: string, scope: string, value: unknown) =>
      storage.setItem(
        `hafa-workouts:v1:${encodeURIComponent(owner)}:${encodeURIComponent(scope)}`,
        JSON.stringify(value)
      )
  };
  const api = {
    capabilities: fixture.capabilities,
    publishingDisclosure: fixture.publishingDisclosure,
    acceptPublishingDisclosure: fixture.acceptPublishingDisclosure,
    duplicateSources: async () => ({ matches: [] }),
    startImport: fixture.startImport,
    setAiConsent: fixture.setAiConsent,
    aiConsent: fixture.aiConsent,
    saveWorkout: fixture.saveWorkout,
    importJob: fixture.importJob,
    cancelImport: fixture.cancelImport,
    acceptImport: fixture.acceptImport,
    importSource: fixture.importSource,
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
      enrollment: { enrolled: true, generation: fixture.generation },
      units: "metric",
      isCurrentAccount: () => fixture.current,
      storage,
      api,
      localDrafts: localDrafts
    })
  };
});
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Platform: { get OS() { return fixture.os; } },
  View: "View",
  Image: "Image",
  Alert: { alert: fixture.alert },
  AppState: { currentState: "active", addEventListener: (_event: string, listener: (state: string) => void) => {
    fixture.foreground.add(listener); return { remove: () => fixture.foreground.delete(listener) };
  } },
  Linking: { openURL: vi.fn() }
}));
vi.mock("@/components/native-share-session", () => ({ useNativeShareSession() {} }));
vi.mock("@/modules/hafa-workouts-share/src", () => ({
  get nativeSharingAvailable() { return fixture.nativeSharing; }, captures: fixture.nativeCaptures, acknowledge: fixture.nativeAck,
}));
vi.mock("@/components/source-image", () => ({ SourceImage: "SourceImage" }));
vi.mock("@/lib/capture-io", () => ({
  normalizeImages: fixture.normalizeImages,
  normalizeDocument: fixture.normalizeDocument,
  pickImages: fixture.pickImages,
  pickDocument: fixture.pickDocument,
  cleanupCaptureFiles: fixture.cleanup,
  sourceFor: fixture.sourceFor
}));
vi.mock("expo-router", () => ({
  router: { push: fixture.push, replace: fixture.replace, dismissTo: fixture.dismissTo },
  useFocusEffect() {},
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
  Empty: "Empty",
  AccountButton: "AccountButton",
  Chip: "Chip",
  ChipRow: "ChipRow",
  Grow: "Grow",
  IconButton: "IconButton",
  ListGroup: "ListGroup",
  ListRow: "ListRow",
  Row: "Row",
  SectionHeader: "SectionHeader",
  Segmented: "Segmented",
  Skeleton: "Skeleton",
  Stack: "Stack"
}));
vi.mock("@/components/query-state", () => ({ QueryState: "QueryState" }));
vi.mock("@/components/publishing-disclosure", async () => {
  const { withPublishingDisclosure } = await import("./discover");
  return { usePublishingDisclosure: () => ({ run: (attempt: () => Promise<unknown>) => withPublishingDisclosure(attempt, {
    status: fixture.publishingDisclosure, accept: fixture.acceptPublishingDisclosure, ask: async () => fixture.publishingAgreed,
  }), sheet: null, dismiss() {} }) };
});
vi.mock("@/lib/native-share-session", () => ({
  setNativeShareVisibility: fixture.nativePreference,
  updateNativeSharingConsent: (change: () => Promise<unknown>) => change(),
}));
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
import ImportReview from "../app/import/[id]";
import RecoverWorkout from "../app/recover-workout/[id]";
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
  fixture.generation = 1;
  fixture.writeFailure = false;
  fixture.readFailure = false;
  fixture.removeFailureScope = "";
  fixture.current = true;
  fixture.next = 0;
  fixture.share = false;
  fixture.foreground.clear();
  fixture.os = "android"; fixture.nativeSharing = false;
  fixture.intent = { webUrl: "", text: "", files: [] };
  for (const value of Object.values(fixture)) if (typeof value === "function") value.mockReset();
  fixture.aiConsent.mockResolvedValue({ accepted: true, disclosure_version: 1 });
  fixture.capabilities.mockResolvedValue({ imports: true, limits: { successful_or_pending_imports_per_rolling_day: 3 } });
  fixture.publishingRequired = false; fixture.publishingAgreed = true;
  fixture.publishingDisclosure.mockImplementation(async () => ({ requires_acceptance: fixture.publishingRequired, current_version: 1 }));
  fixture.acceptPublishingDisclosure.mockImplementation(async () => { fixture.publishingRequired = false; return {}; });
  fixture.nativePreference.mockImplementation(async (_storage, _owner, _value, guard) => guard());
  fixture.nativeCaptures.mockResolvedValue([]); fixture.nativeAck.mockResolvedValue(true);
  fixture.persist.mockImplementation(async (key: string, value: string) => {
    fixture.map.set(key, value);
  });
  fixture.importJob.mockResolvedValue({ id: "job-A", generation: 1, status: "processing" });
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

const overlappingCapture = () => createElement(Fragment, null, createElement(Capture), createElement(ShareCapture));



const rerender = async (component: ComponentType) => {
  await act(async () => {
    renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(component)));
  });
  await settle();
};
it("mounted Capture and ShareCapture keep the shared source when an older same-account picker finishes later", async () => {
  const prior = {
    uri: "file:///cache/hafa-workouts-capture/prior-A.jpg",
    name: "Prior",
    mime_type: "image/jpeg",
    owned: true
  };
  fixture.map.set(
    draftKey(fixture.owner, "capture:1"),
    JSON.stringify({
      generation: 1,
      request_id: "source-A",
      kind: "images",
      text: "A caption",
      source_url: "",
      files: [prior]
    })
  );
  await mount(overlappingCapture);
  const picker = deferred<import("./capture").CaptureFile[]>();
  fixture.pickImages.mockReturnValueOnce(picker.promise);
  await click("Choose up to four images");
  const b = {
    uri: "file:///cache/hafa-workouts-capture/source-B.jpg",
    name: "B",
    mime_type: "image/jpeg",
    owned: true
  };
  fixture.normalizeImages.mockResolvedValueOnce([b]);
  fixture.share = true;
  fixture.intent = {
    webUrl: "",
    text: "B caption",
    files: [{ path: "file:///user/B-original.jpg", mimeType: "image/jpeg", fileName: "B" }]
  };
  await rerender(overlappingCapture);
  await act(async () => fixture.alert.mock.calls[0][2][1].onPress());
  await settle();
  const accepted = fixture.map.get(draftKey(fixture.owner, "capture:1"))!;
  expect(JSON.parse(accepted)).toMatchObject({ text: "B caption", files: [b] });
  expect(JSON.parse(accepted).cleanup_files ?? []).toEqual([]);
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/capture", params: { shared: "1", request_id: expect.any(String) } });
  const late = {
    uri: "file:///cache/hafa-workouts-capture/late-A.jpg",
    name: "Late A",
    mime_type: "image/jpeg",
    owned: true
  };
  await act(async () => picker.resolve([late]));
  await settle();
  expect(fixture.map.get(draftKey(fixture.owner, "capture:1"))).toBe(accepted);
  expect(fixture.cleanup).toHaveBeenCalledWith([late], true);
  expect(fixture.cleanup.mock.calls.flatMap((call) => call[0]).some((file) => file.uri === b.uri)).toBe(false);
  expect(fixture.cleanup).toHaveBeenCalledWith([prior], true);
  expect(button("Load saved source")).toBeDefined();
  await click("Load saved source");
  expect(nodes("SourceImage")[0].props.uri).toBe(b.uri);
});

it("mounted share checks the newly rendered fingerprint before the old passive effect cleanup", async () => {
  fixture.share = true;
  fixture.intent = {
    webUrl: "",
    text: "",
    files: [{ path: "file:///user/A.jpg", mimeType: "image/jpeg", fileName: "A" }]
  };
  const normalized = deferred<import("./capture").CaptureFile[]>();
  fixture.normalizeImages.mockReturnValueOnce(normalized.promise);
  let oldGuard: (() => void) | undefined,
    inspected = false;
  function Harness() {
    const fingerprint = fixture.intent.text;
    useLayoutEffect(() => {
      if (fingerprint === "New source" && oldGuard) {
        inspected = true;
        expect(oldGuard).toThrow("shared source or account changed");
      }
    }, [fingerprint]);
    return createElement(ShareCapture);
  }
  await mount(Harness);
  oldGuard = fixture.normalizeImages.mock.calls[0][1];
  fixture.intent = { webUrl: "", text: "New source", files: [] };
  await rerender(Harness);
  expect(inspected).toBe(true);
  const accepted = fixture.map.get(draftKey(fixture.owner, "capture:1"));
  const late = [
    { uri: "file:///cache/hafa-workouts-capture/old-render.jpg", mime_type: "image/jpeg", name: "Old", owned: true }
  ];
  await act(async () => normalized.resolve(late));
  await settle();
  expect(fixture.map.get(draftKey(fixture.owner, "capture:1"))).toBe(accepted);
  expect(fixture.cleanup).toHaveBeenCalledWith(late, true);
});

it("a discarded owner render cannot delete files already registered by the committed share", async () => {
  fixture.share = true;
  fixture.intent = { webUrl: "", text: "", files: [{ path: "file:///user/A.jpg", mimeType: "image/jpeg", fileName: "A" }] };
  const owner = fixture.owner;
  const file = { uri: "file:///cache/hafa-workouts-capture/registered-A.jpg", name: "A", mime_type: "image/jpeg", owned: true };
  fixture.normalizeImages.mockResolvedValueOnce([file]);
  const cleanup = deferred<void>();
  fixture.cleanup.mockReturnValueOnce(cleanup.promise);
  let discard = false, attempts = 0;
  const suspended = new Promise<void>(() => undefined);
  function Blocker() { if (discard) { attempts++; throw suspended; } return null; }
  function Source() { return createElement("CommittedSource", { owner: fixture.owner }, createElement(ShareCapture), createElement(Blocker)); }
  function Harness() { return createElement(Suspense, { fallback: null }, createElement(Source)); }
  await mount(Harness);
  expect(JSON.parse(fixture.map.get(draftKey(owner, "capture:1"))!).files).toEqual([file]);
  discard = true; fixture.owner = "speculative-owner";
  await act(async () => { startTransition(() => renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(Harness)))); });
  expect(attempts).toBeGreaterThan(0);
  expect(nodes("CommittedSource")[0].props.owner).toBe(owner);
  await act(async () => cleanup.reject(Error("retained cleanup failed")));
  await settle();
  expect(JSON.parse(fixture.map.get(draftKey(owner, "capture:1"))!).files).toEqual([file]);
  expect(fixture.cleanup.mock.calls.flatMap(call => call[0]).some(asset => asset.uri === file.uri)).toBe(false);
});

it("same-slot compare/save stays serialized through delayed storage and an intentional shared replacement", async () => {
  await mount(overlappingCapture);
  const entered = deferred<void>(),
    held = deferred<void>();
  fixture.persist.mockImplementation(async (key: string, value: string) => {
    if (JSON.parse(value).source_url === "https://example.test/delayed-A") {
      entered.resolve();
      await held.promise;
    }
    fixture.map.set(key, value);
  });
  await act(async () => nodes("Field")[0].props.onChange("https://example.test/delayed-A"));
  await entered.promise;
  fixture.share = true;
  fixture.intent = { webUrl: "https://example.test/B", text: "", files: [] };
  await rerender(overlappingCapture);
  expect(fixture.alert).not.toHaveBeenCalled(); // Share cannot read/commit inside A's conditional write.
  await act(async () => held.resolve());
  await settle();
  await act(async () => fixture.alert.mock.calls[0][2][1].onPress());
  await settle();
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "capture:1"))!).source_url).toBe("https://example.test/B");
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/capture", params: { shared: "1", request_id: expect.any(String) } });
});

it("a changed share intent during an acknowledged storage write never deletes its still-registered source", async () => {
  fixture.share = true;
  fixture.intent = {
    webUrl: "",
    text: "",
    files: [{ path: "file:///user/B.jpg", mimeType: "image/jpeg", fileName: "B" }]
  };
  const b = {
    uri: "file:///cache/hafa-workouts-capture/registered-B.jpg",
    name: "B",
    mime_type: "image/jpeg",
    owned: true
  };
  fixture.normalizeImages.mockResolvedValueOnce([b]);
  const entered = deferred<void>(),
    held = deferred<void>();
  fixture.persist.mockImplementation(async (key: string, value: string) => {
    fixture.map.set(key, value);
    if (JSON.parse(value).files?.some((file: { uri: string }) => file.uri === b.uri)) {
      entered.resolve();
      await held.promise;
    }
  });
  await mount(ShareCapture);
  await entered.promise;
  fixture.intent = {
    webUrl: "",
    text: "",
    files: [{ path: "file:///user/unsupported.pdf", mimeType: "application/pdf", fileName: "New" }]
  };
  await rerender(ShareCapture);
  await act(async () => held.resolve());
  await settle();
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "capture:1"))!).files).toEqual([b]);
  expect(fixture.cleanup.mock.calls.flatMap((call) => call[0]).some((file) => file.uri === b.uri)).toBe(false);
});

it("a committed capture-slot write with a lost local acknowledgement preserves registered assets and completes the shared replacement", async () => {
  fixture.share = true;
  fixture.intent = {
    webUrl: "",
    text: "",
    files: [{ path: "file:///user/B.jpg", mimeType: "image/jpeg", fileName: "B" }]
  };
  const b = {
    uri: "file:///cache/hafa-workouts-capture/acknowledged-B.jpg",
    name: "B",
    mime_type: "image/jpeg",
    owned: true
  };
  fixture.normalizeImages.mockResolvedValueOnce([b]);
  let dropped = false;
  fixture.persist.mockImplementation(async (key: string, value: string) => {
    fixture.map.set(key, value);
    if (JSON.parse(value).files?.some((file: { uri: string }) => file.uri === b.uri) && !dropped) {
      dropped = true;
      throw Error("local acknowledgement lost after commit");
    }
  });
  await mount(ShareCapture);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "capture:1"))!).files).toEqual([b]);
  expect(fixture.cleanup.mock.calls.flatMap((call) => call[0]).some((file) => file.uri === b.uri)).toBe(false);
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/capture", params: { shared: "1", request_id: expect.any(String) } });
});

it("old import cancellation conditionally retires its source without removing a newer same-slot shared draft", async () => {
  fixture.params = { id: "job-A" };
  fixture.map.set(
    draftKey(fixture.owner, "capture:1"),
    JSON.stringify({
      generation: 1,
      request_id: "A",
      job_id: "job-A",
      pending_import: true,
      kind: "text",
      text: "A",
      source_url: "",
      files: []
    })
  );
  const importAndShare = () => createElement(Fragment, null, createElement(ImportReview), createElement(ShareCapture));
  await mount(importAndShare);
  const cancel = deferred<void>();
  fixture.cancelImport.mockReturnValueOnce(cancel.promise);
  await click("Cancel import and clear source upload");
  fixture.share = true;
  fixture.intent = { webUrl: "", text: "B source", files: [] };
  await rerender(importAndShare);
  const accepted = fixture.map.get(draftKey(fixture.owner, "capture:1"));
  expect(JSON.parse(accepted!).text).toBe("B source");
  await act(async () => cancel.resolve());
  await settle();
  expect(fixture.map.get(draftKey(fixture.owner, "capture:1"))).toBe(accepted);
});

it("reused ImportReview route B never retires capture A when the same slot nonce still matches", async () => {
  fixture.params = { id: "job-A" };
  const key = draftKey(fixture.owner, "capture:1");
  const file = {
    uri: "file:///cache/hafa-workouts-capture/route-A.jpg",
    name: "A",
    mime_type: "image/jpeg",
    owned: true
  };
  fixture.map.set(
    key,
    JSON.stringify({
      generation: 1,
      request_id: "A",
      job_id: "job-A",
      kind: "images",
      text: "A",
      source_url: "",
      files: [file]
    })
  );
  fixture.importJob.mockImplementation(async (id) => ({ id, generation: 1, status: "processing" }));
  fixture.cancelImport.mockResolvedValue(undefined);
  await mount(ImportReview);
  const sameSource = fixture.map.get(key);
  fixture.params = { id: "job-B" };
  await rerender(ImportReview);
  await click("Cancel import and clear source upload");
  expect(fixture.cancelImport).toHaveBeenCalledWith("job-B", 1);
  expect(fixture.cleanup).not.toHaveBeenCalled();
  expect(fixture.map.get(key)).toBe(sameSource);
});

it("reused ImportReview route clears A source, corrections and review state before accepting B", async () => {
  fixture.params = { id: "job-A" };
  const key = draftKey(fixture.owner, "capture:1");
  const file = {
    uri: "file:///cache/hafa-workouts-capture/accept-A.jpg",
    name: "A",
    mime_type: "image/jpeg",
    owned: true
  };
  fixture.map.set(
    key,
    JSON.stringify({
      generation: 1,
      request_id: "A",
      job_id: "job-A",
      kind: "images",
      text: "A",
      source_url: "",
      files: [file]
    })
  );
  const bWorkout = { ...workout, title: "B original" };
  fixture.importJob.mockImplementation(async (id) => ({
    id,
    generation: 1,
    status: "ready",
    result: {
      workout: id === "job-A" ? workout : bWorkout,
      source: { platform: "unknown", channels: [], coverage_notes: [] },
      warnings: [],
      evidence: []
    }
  }));
  fixture.importSource.mockResolvedValue({ images: [], text: "" });
  fixture.acceptImport.mockResolvedValue({ id: "saved-B" });
  await mount(ImportReview);
  const sameSource = fixture.map.get(key);
  await click("Correct workout details");
  await act(async () => find("WorkoutEditor").props.onChange({ ...workout, title: "A private correction" }));
  fixture.params = { id: "job-B" };
  await rerender(ImportReview);
  expect(nodes("SourceImage")).toHaveLength(0);
  expect(nodes("WorkoutEditor")).toHaveLength(0);
  expect(button("Save workout").props.disabled).toBe(false);
  await click("Save workout");
  expect(fixture.acceptImport).toHaveBeenCalledWith("job-B", bWorkout, 1, false, true);
  expect(fixture.cleanup).not.toHaveBeenCalled();
  expect(fixture.map.get(key)).toBe(sameSource);
  expect(fixture.replace).toHaveBeenCalledWith({ pathname: "/workout/[id]", params: { id: "saved-B" } });
});

it("a held import cancellation cannot retire its source after route A to B to A reuse", async () => {
  fixture.params = { id: "job-A" };
  const key = draftKey(fixture.owner, "capture:1");
  fixture.map.set(
    key,
    JSON.stringify({
      generation: 1,
      request_id: "A",
      job_id: "job-A",
      kind: "text",
      text: "A",
      source_url: "",
      files: []
    })
  );
  fixture.importJob.mockImplementation(async (id) => ({ id, generation: 1, status: "processing" }));
  const response = deferred<void>();
  fixture.cancelImport.mockReturnValue(response.promise);
  await mount(ImportReview);
  const sameSource = fixture.map.get(key);
  const oldCancel = button("Cancel import and clear source upload").props.onPress;
  await click("Cancel import and clear source upload");
  fixture.params = { id: "job-B" };
  await rerender(ImportReview);
  fixture.params = { id: "job-A" };
  await rerender(ImportReview);
  await act(async () => oldCancel());
  expect(fixture.cancelImport).toHaveBeenCalledTimes(1);
  await act(async () => response.resolve());
  await settle();
  expect(fixture.cleanup).not.toHaveBeenCalled();
  expect(fixture.map.get(key)).toBe(sameSource);
});

it("matching import identity preserves cleanup retry while a different source generation cannot be retired", async () => {
  fixture.params = { id: "job-A" };
  const key = draftKey(fixture.owner, "capture:1");
  const file = {
    uri: "file:///cache/hafa-workouts-capture/retry-A.jpg",
    name: "A",
    mime_type: "image/jpeg",
    owned: true
  };
  const draft = {
    generation: 2,
    request_id: "A",
    job_id: "job-A",
    kind: "images",
    text: "A",
    source_url: "",
    files: [file]
  };
  fixture.map.set(key, JSON.stringify(draft));
  fixture.cancelImport.mockResolvedValue(undefined);
  await mount(ImportReview);
  const wrongGeneration = fixture.map.get(key);
  await click("Cancel import and clear source upload");
  expect(fixture.cleanup).not.toHaveBeenCalled();
  expect(fixture.map.get(key)).toBe(wrongGeneration);
  await unmount();
  fixture.map.set(key, JSON.stringify({ ...draft, generation: 1 }));
  await mount(ImportReview);
  fixture.cleanup.mockRejectedValueOnce(Error("retry exact file deletion"));
  await click("Cancel import and clear source upload");
  expect(JSON.parse(fixture.map.get(key)!)).toMatchObject({
    job_id: "job-A",
    generation: 1,
    files: [],
    cleanup_files: [file]
  });
  await click("Cancel import and clear source upload");
  expect(fixture.cleanup).toHaveBeenLastCalledWith([file], true);
  expect(fixture.map.has(key)).toBe(false);
});

it("import retirement keeps exact cleanup references until deletion succeeds and transfers them to an intentional newer source", async () => {
  fixture.params = { id: "job-A" };
  const old = {
    uri: "file:///cache/hafa-workouts-capture/import-A.jpg",
    name: "A",
    mime_type: "image/jpeg",
    owned: true
  };
  fixture.map.set(
    draftKey(fixture.owner, "capture:1"),
    JSON.stringify({
      generation: 1,
      request_id: "A",
      job_id: "job-A",
      pending_import: true,
      kind: "images",
      text: "",
      source_url: "",
      files: [old]
    })
  );
  const importAndShare = () => createElement(Fragment, null, createElement(ImportReview), createElement(ShareCapture));
  await mount(importAndShare);
  fixture.cancelImport.mockResolvedValue(undefined);
  fixture.cleanup.mockRejectedValueOnce(Error("file deletion needs retry"));
  await click("Cancel import and clear source upload");
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "capture:1"))!)).toMatchObject({
    files: [],
    cleanup_files: [old]
  });
  fixture.share = true;
  fixture.intent = { webUrl: "", text: "New B", files: [] };
  await rerender(importAndShare);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, submittedCaptureScope(1, "job-A")))!)).toMatchObject({ cleanup_files: [old] });
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "capture:1"))!).text).toBe("New B");
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "capture:1"))!).cleanup_files ?? []).toEqual([]);
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
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "capture:1"))!)).toMatchObject(prior);
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
  await click("Other ways to add a workout");
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
  fixture.startImport.mockRejectedValueOnce(Error("lost acknowledgment"));
  await click("Extract workout");
  await act(async () => stale("https://example.test/new-intent"));
  const original = fixture.startImport.mock.calls[0];
  await unmount();
  await mount(Capture);
  expect(nodes("Field")[0].props.value).toBe("https://example.test/original");
  fixture.startImport.mockResolvedValueOnce({ id: "saved-import" });
  await click("Retry extraction");
  expect(fixture.startImport.mock.calls[1]).toEqual(original);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, submittedCaptureScope(1, "saved-import")))!)).toMatchObject({
    pending_import: true,
    job_id: "saved-import"
  });
});

it("mounted source import checks owner retirement again after asynchronous consent before sending the source", async () => {
  fixture.aiConsent.mockResolvedValue({ accepted: false, disclosure_version: 1 });
  await mount(Capture);
  await act(async () => nodes("Field")[0].props.onChange("https://example.test/original"));
  const consent = deferred<void>();
  fixture.setAiConsent.mockReturnValueOnce(consent.promise);
  await click("Agree and extract");
  fixture.current = false;
  await act(async () => consent.resolve());
  await settle();
  expect(fixture.startImport).not.toHaveBeenCalled();
});

it("mounted manual creation locks stale callbacks and replays identical body/key after lost acknowledgment and remount", async () => {
  await mount(AddWorkout);
  const editor = () => nodes("WorkoutEditor")[0];
  await act(async () => editor().props.onChange({
    ...editor().props.value, title: "Original",
    blocks: [{ id: "main", label: "Main session", grouping: "sequential", exercises: [{ name: "Row" }] }]
  }));
  const staleEdit = editor().props.onChange, originalContent = editor().props.value;
  const staleChange = (title: string) => staleEdit({ ...originalContent, title });
  const pending = deferred<Workout>();
  fixture.saveWorkout.mockReturnValueOnce(pending.promise);
  await click("Save to my library");
  expect(button("Saving workout…").props.busy).toBe(true);
  const original = fixture.saveWorkout.mock.calls[0];
  expect(original[0].title).toBe("Original");
  expect(original[1]).toMatch(/^command-/);
  expect(original[2]).toBe(1);
  await act(async () => staleChange("Newer unwanted edit"));
  expect(fixture.map.get(draftKey(fixture.owner, "manual-workout:1"))).not.toContain("Newer unwanted edit");
  await act(async () => pending.reject(Error("lost acknowledgment")));
  await settle();
  await act(async () => staleChange("Late failed-save input"));
  expect(editor().props.value.title).toBe("Original");
  await unmount();
  await mount(AddWorkout);
  expect(editor().props.disabled).toBe(true);
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
  const reset = deferred<void>();
  fixture.persist.mockImplementationOnce(async (key: string, value: string) => {
    await reset.promise;
    fixture.map.set(key, value);
  });
  await click("Start another workout and discard this draft");
  expect(button("Starting another workout…").props.busy).toBe(true);
  await act(async () => reset.resolve());
  await settle();
  await act(async () => editor().props.onChange({ ...editor().props.value, title: "Separate deliberate workout" }));
  await act(async () => editor().props.onChange({ ...editor().props.value,
    blocks: [{ id: "main", label: "Session", grouping: "sequential", exercises: [{ name: "Squat" }] }] }));
  fixture.saveWorkout.mockResolvedValueOnce(workout);
  await click("Save to my library");
  expect(fixture.saveWorkout.mock.calls[3][1]).not.toBe(original[1]);
});

it("fences stale create callbacks and restores a separate draft when account or enrollment changes", async () => {
  await mount(AddWorkout);
  const editor = () => nodes("WorkoutEditor")[0];
  const updateOld = editor().props.onChange;
  await act(async () => updateOld({ ...editor().props.value, title: "First account" }));
  const oldKey = draftKey(fixture.owner, "manual-workout:1");
  fixture.owner = "separate-create-owner"; fixture.generation = 2;
  await rerender(AddWorkout);
  expect(editor().props.value.title).toBe("");
  await act(async () => updateOld({ ...editor().props.value, title: "Stale callback" }));
  expect(editor().props.value.title).toBe("");
  expect(fixture.map.get(oldKey)).toContain("First account");
  expect(fixture.map.has(draftKey(fixture.owner, "manual-workout:2"))).toBe(false);
});

it("creates a rich AMRAP with instructions without a second edit and restores its device draft", async () => {
  await mount(AddWorkout);
  const rich: AuthoredWorkout = { title: "20-minute kettlebell circuit", kind: "session", provenance: "user",
    equipment_required: ["Kettlebell"], estimated_minutes: 20, instructions: ["Rest after each round."], notes: ["My private target"],
    blocks: [{ id: "main", label: "Circuit", grouping: "circuit", execution: { mode: "amrap", time_cap_seconds: 1200 },
      rest_between_rounds_seconds: 30, exercises: [{ name: "Press", reps_min: 5, per_side: true, rest_seconds: 10,
        duration_seconds: 30, distance_meters: 20, load: 12, load_unit: "kg", load_convention: "total", instructions: "Stay tall.", notes: "My private cue" }] }] };
  await act(async () => nodes("WorkoutEditor")[0].props.onChange(rich));
  await unmount(); await mount(AddWorkout);
  expect(nodes("WorkoutEditor")[0].props.value).toEqual(rich);
  fixture.saveWorkout.mockResolvedValueOnce(workout);
  await click("Save to my library");
  expect(fixture.saveWorkout.mock.calls[0][0]).toMatchObject(rich);
});

it.each([
  { instructions: "x".repeat(2001) },
  { notes: "x".repeat(2001) },
  { load: 2001, load_unit: "kg" as const, load_convention: "total" as const },
])("keeps invalid rich input editable before freezing a save: %j", async invalid => {
  await mount(AddWorkout);
  const editor = () => nodes("WorkoutEditor")[0];
  await act(async () => editor().props.onChange({ ...editor().props.value, title: "Keep my draft",
    blocks: [{ id: "main", label: "Session", grouping: "sequential", exercises: [{ name: "Press", ...invalid }] }] }));
  await click("Save to my library");
  expect(fixture.saveWorkout).not.toHaveBeenCalled();
  expect(editor().props.disabled).toBe(false);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "manual-workout:1"))!).command).toBeNull();
  await act(async () => editor().props.onChange({ ...editor().props.value,
    blocks: [{ ...editor().props.value.blocks[0], exercises: [{ name: "Press", load: 12, load_unit: "kg", load_convention: "total", notes: "Stay tall" }] }] }));
  fixture.saveWorkout.mockResolvedValueOnce(workout);
  await click("Save to my library");
  expect(fixture.saveWorkout).toHaveBeenCalledTimes(1);
  expect(fixture.saveWorkout.mock.calls[0][0]).toMatchObject({ title: "Keep my draft", blocks: [{ exercises: [{ load: 12, notes: "Stay tall" }] }] });
});

it("restores legacy manual input and retries its frozen pre-upgrade command unchanged", async () => {
  const key = draftKey(fixture.owner, "manual-workout:1");
  const legacy = { title: "Before update", equipment: "Bench, Dumbbells", creation_key: "old-key",
    exercises: [{ name: "Press", sets: "3", reps: "8" }] };
  fixture.map.set(key, JSON.stringify(legacy));
  await mount(AddWorkout);
  expect(nodes("WorkoutEditor")[0].props.value).toMatchObject({ title: legacy.title,
    equipment_required: ["Bench", "Dumbbells"], blocks: [{ exercises: [{ name: "Press", sets: 3, reps_min: 8, reps_max: 8 }] }] });
  await unmount();
  const command = { key: "frozen-key", generation: 1, workout: { ...workout, title: "Original frozen body" } };
  fixture.map.set(key, JSON.stringify({ version: 1, input: legacy, command, terminal: false, removed: false }));
  await mount(AddWorkout);
  expect(nodes("WorkoutEditor")[0].props.disabled).toBe(true);
  fixture.saveWorkout.mockRejectedValueOnce(Error("offline"));
  await click("Retry saving workout");
  expect(fixture.saveWorkout).toHaveBeenCalledWith(command.workout, command.key, command.generation);
});

it("keeps creation locked after a failed draft read and restores the original pending save on retry", async () => {
  const key = draftKey(fixture.owner, "manual-workout:1");
  const command = { key: "pending-before-read-failure", generation: 1, workout: { ...workout, title: "Keep original save" } };
  const stored = JSON.stringify({ version: 1, input: { workout: command.workout }, command, terminal: false, removed: false });
  fixture.map.set(key, stored);
  fixture.readFailure = true;
  await mount(AddWorkout);
  expect(nodes("WorkoutEditor")).toHaveLength(0);
  expect(button("Save to my library").props.disabled).toBe(true);
  expect(fixture.map.get(key)).toBe(stored);
  expect(fixture.saveWorkout).not.toHaveBeenCalled();
  fixture.readFailure = false;
  await click("Retry loading draft");
  expect(nodes("WorkoutEditor")[0].props.disabled).toBe(true);
  fixture.saveWorkout.mockRejectedValueOnce(Error("offline"));
  await click("Retry saving workout");
  expect(fixture.saveWorkout).toHaveBeenCalledWith(command.workout, command.key, command.generation);
});

it("keeps invalid legacy numeric text editable rather than replacing it with missing values", async () => {
  const key = draftKey(fixture.owner, "manual-workout:1");
  fixture.map.set(key, JSON.stringify({ title: "Keep me", equipment: "", exercises: [{ name: "Row", sets: "2.5", reps: "8" }] }));
  await mount(AddWorkout);
  expect(nodes("WorkoutEditor")).toHaveLength(0);
  const sets = nodes("Field").find(node => node.props.label === "Sets")!;
  expect(sets.props.value).toBe("2.5");
  await act(async () => sets.props.onChange("3"));
  expect(nodes("WorkoutEditor")[0].props.value.blocks[0].exercises[0].sets).toBe(3);
  expect(JSON.parse(fixture.map.get(key)!).input.workout.title).toBe("Keep me");
});

it("does not send rich creation when its device command cannot be saved or the account retires", async () => {
  await mount(AddWorkout);
  const editor = () => nodes("WorkoutEditor")[0];
  await act(async () => editor().props.onChange({ ...editor().props.value, title: "Private",
    blocks: [{ id: "main", label: "Session", grouping: "sequential", exercises: [{ name: "Row" }] }] }));
  fixture.writeFailure = true;
  await click("Save to my library");
  expect(fixture.saveWorkout).not.toHaveBeenCalled();
  fixture.writeFailure = false; fixture.current = false;
  const before = editor().props.value;
  await act(async () => editor().props.onChange({ ...before, title: "Other account" }));
  expect(editor().props.value).toEqual(before);
  await click("Save to my library");
  expect(fixture.saveWorkout).not.toHaveBeenCalled();
});

it("mounted form never transmits a command when its original local persistence fails", async () => {
  await mount(AddWorkout);
  await act(async () => nodes("WorkoutEditor")[0].props.onChange({
    ...nodes("WorkoutEditor")[0].props.value, title: "Original",
    blocks: [{ id: "main", label: "Main session", grouping: "sequential", exercises: [{ name: "Row" }] }]
  }));
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

it("mounted workout editing preserves spaces and newlines while instructions are being typed", async () => {
  fixture.params = { id: "workout" };
  await mount(EditWorkout);
  for (const field of ["instructions", "notes"] as const) {
    for (const lines of [["Rest "], ["Rest after each round.", ""], ["Rest after each round.", "Repeat "]]) {
      await act(async () => find("WorkoutEditor").props.onChange({ ...find("WorkoutEditor").props.value, [field]: lines }));
      expect(find("WorkoutEditor").props.value[field]).toEqual(lines);
    }
  }
  await act(async () => find("WorkoutEditor").props.onChange({ ...find("WorkoutEditor").props.value,
    notes: ["Rest after each round.", "Repeat at your own pace."] }));
  await click("Save new workout version");
  expect(fixture.updateWorkout.mock.calls[0][0].notes).toEqual(["Rest after each round.", "Repeat at your own pace."]);
});

it("mounted workout editing preserves original content/revision across background query updates and lost acknowledgment", async () => {
  fixture.params = { id: "workout" };
  await mount(EditWorkout);
  await act(async () => find("WorkoutEditor").props.onChange({ ...workout, title: "Desired correction" }));
  const pending = deferred<Workout>();
  fixture.updateWorkout.mockReturnValueOnce(pending.promise);
  await click("Save new workout version");
  expect(button("Saving changes…").props.busy).toBe(true);
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
  expect(find("WorkoutEditor").props.disabled).toBe(false);
  expect(find("WorkoutEditor").props.value.title).toBe("Desired correction");
  expect(fixture.updateWorkout).toHaveBeenCalledTimes(2);
  expect(fixture.dismissTo).toHaveBeenCalledWith({ pathname: "/workout/[id]", params: { id: "workout" } });
});

it("mounted completed workout edits reopen the current server revision despite a stale cache and can save again", async () => {
  fixture.params = { id: "workout" };
  await mount(EditWorkout);
  const corrected = { ...workout, revision: 2, title: "Saved correction" };
  fixture.updateWorkout.mockResolvedValueOnce(corrected);
  await click("Save new workout version");
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "workout-edit:1:workout"))!)).toMatchObject({
    terminal: true, saved_id: "workout", input: null, command: null
  });
  await unmount();
  cache.setQueryData([fixture.owner, "workout", "workout", 1], workout);
  const fresh = deferred<Workout>();
  fixture.workout.mockReturnValue(fresh.promise);
  await mount(EditWorkout);
  expect(nodes("WorkoutEditor")).toHaveLength(0);
  await act(async () => fresh.resolve(corrected));
  await settle();
  expect(find("WorkoutEditor").props.disabled).toBe(false);
  expect(find("WorkoutEditor").props.value.title).toBe("Saved correction");
  await act(async () => find("WorkoutEditor").props.onChange({ ...corrected, title: "Second correction" }));
  fixture.updateWorkout.mockResolvedValueOnce({ ...corrected, title: "Second correction", revision: 3 });
  await click("Save new workout version");
  expect(fixture.updateWorkout.mock.calls[1][0]).toMatchObject({ revision: 2, title: "Second correction" });
  expect(fixture.dismissTo).toHaveBeenCalledTimes(2);
  expect(fixture.replace).not.toHaveBeenCalled();
});

it("mounted completed workout edits keep their receipt when reopening is offline and recover without replaying a save", async () => {
  fixture.params = { id: "workout" };
  fixture.map.set(draftKey(fixture.owner, "workout-edit:1:workout"), JSON.stringify({
    version: 1, terminal: true, removed: false, saved_id: "workout", input: null, command: null
  }));
  cache.setQueryData([fixture.owner, "workout", "workout", 1], workout);
  fixture.workout.mockRejectedValue(Error("offline"));
  await mount(EditWorkout);
  expect(nodes("WorkoutEditor")).toHaveLength(0);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "workout-edit:1:workout"))!).terminal).toBe(true);
  fixture.workout.mockResolvedValue({ ...workout, revision: 4, title: "Current saved version" });
  await click("Load saved workout");
  expect(find("WorkoutEditor").props.value.title).toBe("Current saved version");
  expect(find("WorkoutEditor").props.disabled).toBe(false);
  expect(fixture.updateWorkout).not.toHaveBeenCalled();
});

it("mounted workout edit preserves its frozen command when saving succeeded but the local receipt write failed", async () => {
  fixture.params = { id: "workout" };
  await mount(EditWorkout);
  fixture.updateWorkout.mockImplementationOnce(async (value) => {
    fixture.writeFailure = true;
    return { ...value, revision: 2 };
  });
  await click("Save new workout version");
  const original = fixture.updateWorkout.mock.calls[0][0];
  expect(fixture.dismissTo).not.toHaveBeenCalled();
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "workout-edit:1:workout"))!).command).toEqual(original);
  fixture.writeFailure = false;
  await unmount();
  await mount(EditWorkout);
  expect(find("WorkoutEditor").props.disabled).toBe(true);
  fixture.updateWorkout.mockResolvedValueOnce({ ...original, revision: 2 });
  await click("Retry saving changes");
  expect(fixture.updateWorkout.mock.calls[1][0]).toEqual(original);
  expect(fixture.dismissTo).toHaveBeenCalledTimes(1);
});

it("mounted completed workout edit cannot reopen after its owner changes during the fresh read", async () => {
  fixture.params = { id: "workout" };
  const oldOwner = fixture.owner, key = draftKey(oldOwner, "workout-edit:1:workout");
  fixture.map.set(key, JSON.stringify({ version: 1, terminal: true, removed: false, saved_id: "workout", input: null, command: null }));
  const fresh = deferred<Workout>();
  fixture.workout.mockReturnValue(fresh.promise);
  await mount(EditWorkout);
  fixture.workout.mockResolvedValue(workout);
  fixture.owner = "other-owner";
  await rerender(EditWorkout);
  await act(async () => fresh.resolve({ ...workout, revision: 7, title: "Old owner result" }));
  await settle();
  expect(JSON.parse(fixture.map.get(key)!).terminal).toBe(true);
  expect(find("WorkoutEditor").props.value.title).not.toBe("Old owner result");
  expect(fixture.updateWorkout).not.toHaveBeenCalled();
});

it("mounted completed workout edit cannot move its receipt into a new enrollment during the fresh read", async () => {
  fixture.params = { id: "workout" };
  const key = draftKey(fixture.owner, "workout-edit:1:workout");
  fixture.map.set(key, JSON.stringify({ version: 1, terminal: true, removed: false, saved_id: "workout", input: null, command: null }));
  const fresh = deferred<Workout>();
  fixture.workout.mockReturnValue(fresh.promise);
  await mount(EditWorkout);
  fixture.workout.mockResolvedValue({ ...workout, generation: 2, title: "New enrollment workout" });
  fixture.generation = 2;
  await rerender(EditWorkout);
  await act(async () => fresh.resolve({ ...workout, revision: 7, title: "Old enrollment result" }));
  await settle();
  expect(JSON.parse(fixture.map.get(key)!).terminal).toBe(true);
  expect(find("WorkoutEditor").props.value.title).toBe("New enrollment workout");
  expect(fixture.updateWorkout).not.toHaveBeenCalled();
});

it("mounted acknowledged workout edit keeps its completed receipt if returning to the detail fails", async () => {
  fixture.params = { id: "workout" };
  await mount(EditWorkout);
  const saved = { ...workout, revision: 2, title: "Saved correction" };
  fixture.updateWorkout.mockResolvedValueOnce(saved);
  fixture.dismissTo.mockImplementationOnce(() => { throw Error("navigation unavailable"); });
  await click("Save new workout version");
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "workout-edit:1:workout"))!).terminal).toBe(true);
  expect(find("WorkoutEditor").props.disabled).toBe(true);
  await unmount();
  fixture.workout.mockResolvedValue(saved);
  await mount(EditWorkout);
  expect(find("WorkoutEditor").props.disabled).toBe(false);
  expect(find("WorkoutEditor").props.value.title).toBe("Saved correction");
  expect(fixture.updateWorkout).toHaveBeenCalledTimes(1);
});

it("mounted completed workout edit keeps its receipt if reopening cannot be persisted locally", async () => {
  fixture.params = { id: "workout" };
  const key = draftKey(fixture.owner, "workout-edit:1:workout");
  fixture.map.set(key, JSON.stringify({ version: 1, terminal: true, removed: false, saved_id: "workout", input: null, command: null }));
  fixture.writeFailure = true;
  await mount(EditWorkout);
  expect(nodes("WorkoutEditor")).toHaveLength(0);
  expect(JSON.parse(fixture.map.get(key)!).terminal).toBe(true);
  expect(fixture.updateWorkout).not.toHaveBeenCalled();
});

it("mounted completed workout edit stops when removal occurs during its fresh read", async () => {
  fixture.params = { id: "workout" };
  const key = draftKey(fixture.owner, "workout-edit:1:workout");
  fixture.map.set(key, JSON.stringify({ version: 1, terminal: true, removed: false, saved_id: "workout", input: null, command: null }));
  const fresh = deferred<Workout>();
  fixture.workout.mockReturnValue(fresh.promise);
  await mount(EditWorkout);
  await createPrivateForm({ getItem: async (k) => fixture.map.get(k) ?? null,
    setItem: async (k, v) => { fixture.map.set(k, v); }, removeItem: async (k) => { fixture.map.delete(k); } },
    fixture.owner, "workout-edit:1:workout").retire();
  await act(async () => fresh.resolve({ ...workout, revision: 2 }));
  await settle();
  expect(nodes("WorkoutEditor")).toHaveLength(0);
  expect(JSON.parse(fixture.map.get(key)!).removed).toBe(true);
  expect(fixture.updateWorkout).not.toHaveBeenCalled();
});

it("mounted removed workout edit cannot reset its tombstone or expose a cached workout", async () => {
  fixture.params = { id: "workout" };
  const key = draftKey(fixture.owner, "workout-edit:1:workout");
  fixture.map.set(key, JSON.stringify({ version: 1, terminal: true, removed: true, input: null, command: null }));
  cache.setQueryData([fixture.owner, "workout", "workout", 1], workout);
  await mount(EditWorkout);
  expect(nodes("WorkoutEditor")).toHaveLength(0);
  await click("Load saved workout");
  expect(nodes("WorkoutEditor")).toHaveLength(0);
  expect(JSON.parse(fixture.map.get(key)!).removed).toBe(true);
  expect(fixture.updateWorkout).not.toHaveBeenCalled();
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

it("capture slot revisions survive a fresh JS realm and refuse an obsolete source write or removal", async () => {
  const { createPrivateDraftSlot } = await import("./private-form");
  const guard = () => undefined;
  const key = draftKey("capture-cold-reload", "capture:1");
  const raw = {
    getItem: async (k: string) => fixture.map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      fixture.map.set(k, v);
    },
    removeItem: async (k: string) => {
      fixture.map.delete(k);
    }
  };
  const initial = { files: [{ uri: "file:///cache/hafa-workouts-capture/A.jpg" }], text: "A" };
  fixture.map.set(key, JSON.stringify(initial));
  const oldSlot = createPrivateDraftSlot(raw, "capture-cold-reload", "capture:1", () => "legacy-token");
  const old = await oldSlot.load(guard);
  const freshSlot = createPrivateDraftSlot(raw, "capture-cold-reload", "capture:1", () => "new-source-token");
  const next = await freshSlot.save(
    old.revision,
    { files: [{ uri: "file:///cache/hafa-workouts-capture/B.jpg" }], text: "B" },
    guard
  );
  vi.resetModules();
  const { createPrivateDraftSlot: restarted } = await import("./private-form");
  const slot = restarted(raw, "capture-cold-reload", "capture:1", () => "restart-token");
  expect(await slot.load(guard)).toEqual(next);
  await expect(slot.save(old.revision, initial, guard)).rejects.toMatchObject({ captureDraftConflict: true });
  expect(await slot.remove(old.revision, guard)).toBeNull();
  expect(JSON.parse(fixture.map.get(key)!)).toEqual(next.value);
  expect(JSON.parse(fixture.map.get(key)!).files[0].uri).toContain("B.jpg");
});

it("corrects an API microsecond timestamp without changing the original measurement time", async () => {
  fixture.params = { id: "m" };
  const recorded_at = "2026-01-01T10:00:00.903127+10:00";
  fixture.measurement.mockResolvedValue({ ...entry, recorded_at });
  fixture.saveMeasurement.mockRejectedValueOnce(Error("lost reply"));
  await mount(MeasurementEditor);
  expect(find("RecordedTime").props.value).toBe(recorded_at);
  await act(async () => find("Field").props.onChange("76"));
  await click("Save measurement");
  expect(fixture.saveMeasurement).toHaveBeenCalledTimes(1);
  expect(fixture.saveMeasurement.mock.calls[0][1]).toMatchObject({ value: 76, recorded_at });
  await click("Retry this measurement change");
  expect(fixture.saveMeasurement.mock.calls[1]).toEqual(fixture.saveMeasurement.mock.calls[0]);
});

function sharedLinkDraft(request = "shared-link") {
  fixture.params = { shared: "1", request_id: request };
  fixture.map.set(draftKey(fixture.owner, "capture:1"), JSON.stringify({ request_id: request, generation: 1,
    kind: "url", source_url: "https://example.test/shared", text: "Original caption", files: [], created_at: "2026-10-13T00:00:00Z" }));
}
const serverCaps = { imports: true, server_auto_save: true, discover: true, limits: { successful_or_pending_imports_per_rolling_day: 3 } };
it("a native private link overrides the public link default and can save while the app is closed", async () => {
  sharedLinkDraft("native-private");
  const key = draftKey(fixture.owner, "capture:1");
  fixture.map.set(key, JSON.stringify({ ...JSON.parse(fixture.map.get(key)!), is_public: false }));
  fixture.capabilities.mockResolvedValue(serverCaps); fixture.publishingRequired = true;
  fixture.startImport.mockResolvedValue({ id: "private-job" });
  await mount(Capture);
  expect(fixture.startImport).toHaveBeenCalledWith("native-private", expect.anything(), 1, { auto_save: true, is_public: false });
  expect(fixture.acceptPublishingDisclosure).not.toHaveBeenCalled();
  expect(fixture.nativePreference).not.toHaveBeenCalled();
});
it("a public link accepts the disclosure before admitting extraction and remembers the explicit choice", async () => {
  fixture.capabilities.mockResolvedValue(serverCaps); fixture.publishingRequired = true;
  fixture.startImport.mockResolvedValue({ id: "public-job" });
  await mount(Capture);
  await act(async () => nodes("Field").find(node => node.props.label === "Source link")!.props.onChange("https://example.test/source"));
  await click("Extract workout");
  expect(fixture.acceptPublishingDisclosure).toHaveBeenCalledWith(1);
  expect(fixture.acceptPublishingDisclosure.mock.invocationCallOrder[0]).toBeLessThan(fixture.startImport.mock.invocationCallOrder[0]);
  expect(fixture.startImport.mock.calls[0][3]).toEqual({ auto_save: true, is_public: true });
  expect(fixture.nativePreference).toHaveBeenCalledWith(expect.anything(), fixture.owner, true, expect.any(Function));
});
it("declining publication still extracts and saves privately with the original source", async () => {
  fixture.capabilities.mockResolvedValue(serverCaps); fixture.publishingRequired = true; fixture.publishingAgreed = false;
  fixture.startImport.mockResolvedValue({ id: "private-job" });
  await mount(Capture);
  await act(async () => nodes("Field").find(node => node.props.label === "Source link")!.props.onChange("https://example.test/source"));
  await click("Extract workout");
  expect(fixture.acceptPublishingDisclosure).not.toHaveBeenCalled();
  expect(fixture.startImport.mock.calls[0][3]).toEqual({ auto_save: true, is_public: false });
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, submittedCaptureScope(1, "private-job")))!)).toMatchObject({ is_public: false, pending_import: true });
});
it("server-save retry preserves the original private policy after a lost acknowledgement", async () => {
  sharedLinkDraft("private-retry"); const key = draftKey(fixture.owner, "capture:1");
  fixture.map.set(key, JSON.stringify({ ...JSON.parse(fixture.map.get(key)!), is_public: false }));
  fixture.capabilities.mockResolvedValue(serverCaps); fixture.startImport.mockRejectedValueOnce(Error("lost acknowledgement"));
  await mount(Capture); const original = fixture.startImport.mock.calls[0]; await unmount();
  fixture.capabilities.mockResolvedValue({ ...serverCaps, discover: false }); fixture.startImport.mockResolvedValue({ id: "recovered" });
  await mount(Capture); await click("Retry extraction");
  expect(fixture.startImport.mock.calls[1]).toEqual(original);
});

it("a shared link with existing consent starts once without a capture confirmation and preserves its caption", async () => {
  sharedLinkDraft();
  fixture.startImport.mockResolvedValue({ id: "shared-job" });
  await mount(Capture);
  await settle();
  expect(fixture.startImport).toHaveBeenCalledTimes(1);
  expect(fixture.startImport.mock.calls[0][0]).toBe("shared-link");
  expect(fixture.sourceFor.mock.calls[0][0].text).toBe("Original caption");
  expect(fixture.setAiConsent).not.toHaveBeenCalled();
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/import/[id]", params: { id: "shared-job", auto: "1" } });
});
it("a first shared link waits for one explicit AI disclosure action", async () => {
  sharedLinkDraft();
  fixture.aiConsent.mockResolvedValue({ accepted: false, disclosure_version: 1 });
  fixture.startImport.mockResolvedValue({ id: "first-job" });
  await mount(Capture);
  expect(fixture.startImport).not.toHaveBeenCalled();
  await click("Agree and extract");
  expect(fixture.setAiConsent).toHaveBeenCalledWith(true, 1);
  expect(fixture.startImport).toHaveBeenCalledTimes(1);
});
it("a different saved source cannot be automatically submitted for an older share route", async () => {
  sharedLinkDraft("newer-source");
  fixture.params.request_id = "older-source";
  await mount(Capture);
  expect(fixture.startImport).not.toHaveBeenCalled();
});
it("a stale accepted consent display cannot silently re-enable revoked AI consent", async () => {
  fixture.aiConsent.mockResolvedValueOnce({ accepted: true, disclosure_version: 1 })
    .mockResolvedValue({ accepted: false, disclosure_version: 1 });
  await mount(Capture);
  await act(async () => nodes("Field")[0].props.onChange("https://example.test/source"));
  await click("Extract workout");
  expect(fixture.setAiConsent).not.toHaveBeenCalled();
  expect(fixture.startImport).not.toHaveBeenCalled();
  expect(button("Agree and extract")).toBeDefined();
});

async function mountRealWorkoutEditor(content: AuthoredWorkout, disabled = false) {
  const { WorkoutEditor } = await vi.importActual<typeof import("@/components/workout-editor")>("@/components/workout-editor");
  function Controlled() {
    const [value, setValue] = useState(content);
    return createElement(WorkoutEditor, { value, disabled, onChange(next: AuthoredWorkout) { fixture.updateWorkout(next); setValue(next); } });
  }
  await mount(Controlled);
}
it("repairs a restored oversized block list without discarding the remaining prescription", async () => {
  const content: AuthoredWorkout = { ...workout, blocks: Array.from({ length: 101 }, (_, index) => ({
    ...workout.blocks[0], id: `block-${index}`, label: `Block ${index}`,
  })) };
  await mountRealWorkoutEditor(content);
  expect(button("Add another block").props.disabled).toBe(true);
  await click("Add another block");
  expect(fixture.updateWorkout).not.toHaveBeenCalled();
  await click("Remove block: Block 0");
  await click("Keep this block");
  expect(fixture.updateWorkout).not.toHaveBeenCalled();
  await click("Remove block: Block 0");
  await click("Remove this block");
  const repaired = fixture.updateWorkout.mock.lastCall![0] as AuthoredWorkout;
  expect(repaired).toEqual({ ...content, blocks: content.blocks.slice(1) });
  expect(workoutErrors(repaired)).toEqual([]);
  expect(button("Add another block").props.disabled).toBe(true);
  await click("Add another block");
  expect(fixture.updateWorkout).toHaveBeenCalledTimes(1);
  await click("Remove block: Block 1");
  await click("Remove this block");
  expect(button("Add another block").props.disabled).toBe(false);
  await click("Add another block");
  expect(fixture.updateWorkout.mock.lastCall![0].blocks).toHaveLength(100);
});
it("caps additions in a full exercise list while retaining exercise removal", async () => {
  await mountRealWorkoutEditor({ ...workout, blocks: [{ ...workout.blocks[0], exercises: Array.from({ length: 100 }, (_, index) => ({
    name: `Movement ${index}`, provenance: "user" as const,
  })) }] });
  expect(button("Add exercise to this block").props.disabled).toBe(true);
  await click("Add exercise to this block");
  expect(fixture.updateWorkout).not.toHaveBeenCalled();
  await click("Remove Movement 0");
  expect(fixture.updateWorkout.mock.lastCall![0].blocks[0].exercises).toHaveLength(99);
  expect(button("Add exercise to this block").props.disabled).toBe(false);
});
it("keeps unknowns and less common prescription values intact through simple editing and expansion", async () => {
  const content: AuthoredWorkout = { ...workout, provenance: "source", blocks: [{
    id: "main", label: "Strength", grouping: "circuit", rounds: 3, rest_between_rounds_seconds: 60,
    exercises: [{ name: "Row", provenance: "source", reps_min: null, reps_max: null, rest_seconds: 45,
      load: 10, load_unit: "kg", load_convention: "per_hand", tempo: "3-1-1", notes: "Control the movement", per_side: null }],
  }] };
  await mountRealWorkoutEditor(content);
  expect(nodes("Field").map((n) => n.props.label)).toEqual(["Workout title", "Estimated duration · minutes", "Workout instructions · included when sharing", "Private notes · only you", "Required equipment · comma separated", "Exercise name", "Sets", "Reps"]);
  expect(fixture.updateWorkout).not.toHaveBeenCalled();
  await click("More details for Row");
  expect(nodes("Field").find((n) => n.props.label === "Rest · seconds")!.props.value).toBe("45");
  expect(nodes("Field").find((n) => n.props.label === "Source load · kg")!.props.value).toBe("10");
  expect(nodes("Field").find((n) => n.props.label === "Tempo")!.props.value).toBe("3-1-1");
  await click("Hide details for Row");
  await click("Show block settings: Strength");
  expect(nodes("Field").find((n) => n.props.label === "Rounds · separate from exercise sets")!.props.value).toBe("3");
  await click("Hide block settings: Strength");
  expect(fixture.updateWorkout).not.toHaveBeenCalled();
  await act(async () => nodes("Field").find((n) => n.props.label === "Sets")!.props.onChange("2"));
  const corrected = fixture.updateWorkout.mock.calls[0][0];
  expect(corrected.blocks[0]).toEqual({ ...content.blocks[0], exercises: [{ ...content.blocks[0].exercises[0], sets: 2, provenance: "user" }] });
  expect(corrected.blocks[0].exercises[0].reps_min).toBeNull();
  expect(corrected.blocks[0].exercises[0].reps_max).toBeNull();
});
it("corrects overall duration and instructions without changing the exercise prescription", async () => {
  const content: AuthoredWorkout = { ...workout, estimated_minutes: null, instructions: ["Repeat the circuit"], notes: ["Private concern"], provenance: "source" };
  await mountRealWorkoutEditor(content);
  await act(async () => nodes("Field").find((n) => n.props.label === "Estimated duration · minutes")!.props.onChange("20"));
  await act(async () => nodes("Field").find((n) => n.props.label === "Workout instructions · included when sharing")!.props.onChange("Repeat for 20 minutes\nRest after each round"));
  const corrected = fixture.updateWorkout.mock.calls.at(-1)![0];
  expect(corrected.estimated_minutes).toBe(20);
  expect(corrected.instructions).toEqual(["Repeat for 20 minutes", "Rest after each round"]);
  expect(corrected.notes).toEqual(["Private concern"]);
  expect(corrected.blocks).toEqual(content.blocks);
  await act(async () => nodes("Field").find((n) => n.props.label === "Estimated duration · minutes")!.props.onChange(""));
  expect(fixture.updateWorkout.mock.calls.at(-1)![0].estimated_minutes).toBeNull();
});
it("shows existing time and distance without making optional numeric fields into zero", async () => {
  await mountRealWorkoutEditor({ ...workout, blocks: [{ ...workout.blocks[0], exercises: [{ name: "Run", duration_seconds: 60, distance_meters: 400 }] }] });
  expect(nodes("Field").find((n) => n.props.label === "Time · seconds")!.props.value).toBe("60");
  expect(nodes("Field").find((n) => n.props.label === "Distance · metres")!.props.value).toBe("400");
  expect(nodes("Field").find((n) => n.props.label === "Reps")!.props.value).toBe("");
  await act(async () => nodes("Field").find((n) => n.props.label === "Time · seconds")!.props.onChange(""));
  const correction = fixture.updateWorkout.mock.calls[0][0].blocks[0].exercises[0];
  expect(correction.duration_seconds).toBeNull();
  expect(correction.distance_meters).toBe(400);
  expect(correction.reps_min).toBeUndefined();
});
it("edits round rest without losing source credit, cover or warnings, and leaves unknown rest blank", async () => {
  const content = { ...workout, source_title: "Creator source", source_creator: "Creator", source_thumbnail_url: "https://example.test/cover.jpg",
    extraction_warnings: ["Rest was not spoken"], blocks: [{ ...workout.blocks[0], rounds: 6, rest_between_rounds_seconds: 120 }] };
  await mountRealWorkoutEditor(content); await click(`Show block settings: ${content.blocks[0].label}`);
  expect(nodes("Field").find(node => node.props.label === "Rest between rounds · seconds")!.props.value).toBe("120");
  await act(async () => nodes("Field").find(node => node.props.label === "Rest between rounds · seconds")!.props.onChange(""));
  const edited = fixture.updateWorkout.mock.calls[0][0];
  expect(edited.blocks[0].rest_between_rounds_seconds).toBeNull();
  expect(edited).toMatchObject({ source_title: content.source_title, source_creator: content.source_creator,
    source_thumbnail_url: content.source_thumbnail_url, extraction_warnings: content.extraction_warnings });
});
it("keeps invalid optional values visible for correction", async () => {
  await mountRealWorkoutEditor({ ...workout, blocks: [{ ...workout.blocks[0], exercises: [{ name: "Row", load: 10, rest_seconds: -1 }] }] });
  expect(nodes("Field").find((n) => n.props.label === "Rest · seconds")!.props.value).toBe("-1");
  expect(nodes("Field").find((n) => n.props.label === "Source load · select a unit")!.props.value).toBe("10");
  expect(nodes("Choice").find((n) => n.props.label === "kg")).toBeDefined();
  expect(fixture.updateWorkout).not.toHaveBeenCalled();
});
it("does not change or expand a disabled workout editor", async () => {
  await mountRealWorkoutEditor(workout, true);
  expect(nodes("Field").every((n) => n.props.disabled)).toBe(true);
  await act(async () => nodes("Field").find((n) => n.props.label === "Exercise name")!.props.onChange("Changed"));
  await click("More details for Row");
  expect(nodes("Field").find((n) => n.props.label === "Tempo")).toBeUndefined();
  expect(fixture.updateWorkout).not.toHaveBeenCalled();
});

it("changes an AMRAP timer from 20 to 15 minutes while retaining creator instructions and exercise prescriptions", async () => {
  const content: AuthoredWorkout = { ...workout, estimated_minutes: 20, notes: ["Repeat for 20 minutes"], blocks: [{
    ...workout.blocks[0], grouping: "circuit", execution: { mode: "amrap", time_cap_seconds: 1200 },
    exercises: [{ name: "Row", sets: 2, reps_min: 10, evidence: [{ field: "reps_min", wording: "10 reps" }] }],
  }] };
  await mountRealWorkoutEditor(content); await click("Show block settings: Strength");
  expect(nodes("Field").find(n => n.props.label === "Rounds · separate from exercise sets")).toBeUndefined();
  const cap = nodes("Field").find(n => n.props.label === "AMRAP time cap · minutes")!;
  expect(cap.props.value).toBe("20");
  await act(async () => cap.props.onChange("15"));
  expect(fixture.updateWorkout.mock.lastCall![0]).toMatchObject({ estimated_minutes: 15, notes: content.notes,
    blocks: [{ execution: { mode: "amrap", time_cap_seconds: 900 }, exercises: content.blocks[0].exercises }] });
});
it("shows a source's fractional-minute cap as exact seconds and can switch execution without inventing rounds", async () => {
  await mountRealWorkoutEditor({ ...workout, blocks: [{ ...workout.blocks[0], grouping: "circuit",
    execution: { mode: "amrap", time_cap_seconds: 125 } }] });
  await click("Show block settings: Strength");
  expect(nodes("Field").find(n => n.props.label === "AMRAP time cap · seconds")!.props.value).toBe("125");
  await act(async () => nodes("Choice").find(n => n.props.label === "Fixed rounds")!.props.onPress());
  expect(fixture.updateWorkout.mock.lastCall![0].blocks[0].execution).toBeUndefined();
  expect(nodes("Field").find(n => n.props.label === "Rounds · separate from exercise sets")!.props.value).toBe("");
  await act(async () => nodes("Choice").find(n => n.props.label === "AMRAP · repeat until the time cap")!.props.onPress());
  await act(async () => nodes("Choice").find(n => n.props.label === "interval")!.props.onPress());
  expect(fixture.updateWorkout.mock.lastCall![0].blocks[0].execution).toBeUndefined();
});
it.each([0, 86401, 0.5, NaN])("rejects AMRAP cap %s before freezing the saved-workout command", async seconds => {
  fixture.params = { id: "workout" }; await mount(EditWorkout);
  await act(async () => find("WorkoutEditor").props.onChange({ ...workout, blocks: [{ ...workout.blocks[0], grouping: "circuit",
    execution: { mode: "amrap", time_cap_seconds: seconds } }] }));
  await click("Save new workout version");
  expect(fixture.updateWorkout).not.toHaveBeenCalled();
  expect(button("Save new workout version")).toBeDefined();
  const stored = [...fixture.map.values()].map(value => JSON.parse(value)).find(value => value.input?.blocks);
  expect(stored?.command).toBeNull();
});

it("a social app's text-only shared link uses URL extraction and keeps its caption", async () => {
  fixture.share = true;
  fixture.intent = { webUrl: "", text: "Try this workout https://youtu.be/qa-video Three rounds", files: [] };
  await mount(ShareCapture);
  const captured = JSON.parse(fixture.map.get(draftKey(fixture.owner, "capture:1"))!);
  expect(captured).toMatchObject({ kind: "url", source_url: "https://youtu.be/qa-video", text: fixture.intent.text });
  expect(fixture.push).toHaveBeenCalledWith({ pathname: "/capture", params: { shared: "1", request_id: captured.request_id } });
});
it("photo imports keep an explicit review step even when extraction succeeds", async () => {
  fixture.map.set(draftKey(fixture.owner, "capture:1"), JSON.stringify({ request_id: "photo-request", generation: 1,
    kind: "images", source_url: "", text: "", files: [{ uri: "file:///cache/qa.jpg", name: "QA image", mime_type: "image/jpeg", owned: true }],
    created_at: "2026-10-13T00:00:00Z" }));
  fixture.startImport.mockResolvedValue({ id: "photo-job" });
  await mount(Capture); await click("Extract workout");
  const captured = JSON.parse(fixture.map.get(draftKey(fixture.owner, submittedCaptureScope(1, "photo-job")))!);
  expect(captured.auto_save).toBe(false);
  const references = JSON.parse(fixture.map.get(draftKey(fixture.owner, "imports:1"))!);
  expect(references[0]).toMatchObject({ id: "photo-job", auto_save: false });
});


it("returns from a saved incomplete import to the mounted capture and starts another source without loading a missing draft", async () => {
  const key = draftKey(fixture.owner, "capture:1");
  fixture.map.set(key, JSON.stringify({ request_id: "finished-source", generation: 1, kind: "url",
    source_url: "https://example.test/finished", text: "", files: [], pending_import: true, job_id: "finished-job" }));
  fixture.params = { id: "finished-job" };
  fixture.capabilities.mockResolvedValue(serverCaps);
  fixture.importJob.mockResolvedValue({ id: "finished-job", generation: 1, status: "incomplete", accepted_workout_id: "private-draft",
    result: { status: "incomplete", workout: { ...workout, blocks: [] }, warnings: ["No readable exercises"], evidence: [],
      source: { platform: "instagram", channels: [], coverage_notes: [] } } });
  let reviewing = false;
  const journey = () => createElement(Fragment, null, createElement(Capture), reviewing && createElement(ImportReview));
  await mount(journey);
  expect(button("Resume existing import")).toBeDefined();
  expect(nodes("Field")[0].props.disabled).toBe(false);
  reviewing = true; await rerender(journey);
  expect(fixture.map.has(key)).toBe(false);
  reviewing = false; await rerender(journey);
  expect(nodes("Notice").some(node => String(node.props.children).includes("A newer source is saved"))).toBe(false);
  expect(fixture.map.has(draftKey(fixture.owner, submittedCaptureScope(1, "finished-job")))).toBe(false);
  expect(nodes("Field")[0].props.value).toBe("");
  await act(async () => nodes("Field")[0].props.onChange("https://example.test/next"));
  expect(JSON.parse(fixture.map.get(key)!).source_url).toBe("https://example.test/next");
});

it("starting another source from a completed capture cannot overwrite a concurrently shared newer source", async () => {
  const key = draftKey(fixture.owner, "capture:1");
  fixture.map.set(key, JSON.stringify({ request_id: "finished-source", generation: 1, kind: "url",
    source_url: "https://example.test/finished", text: "", files: [], pending_import: true, job_id: "finished-job" }));
  let failArchive = true;
  fixture.persist.mockImplementation(async (storedKey, value) => {
    if (failArchive && storedKey.includes("submitted%3A")) { failArchive = false; throw Error("archive write unavailable"); }
    fixture.map.set(storedKey, value);
  });
  await mount(overlappingCapture);
  const staleStart = button("Start another source draft").props.onPress;
  fixture.share = true; fixture.intent = { webUrl: "https://example.test/newer", text: "A new share", files: [] };
  await rerender(overlappingCapture);
  const newer = fixture.map.get(key);
  expect(JSON.parse(newer!).source_url).toBe("https://example.test/newer");
  await act(async () => staleStart()); await settle();
  expect(fixture.map.get(key)).toBe(newer);
  expect(nodes("Notice").some(node => String(node.props.children).includes("A newer source is saved"))).toBe(true);
  await click("Load saved source");
  expect(nodes("Field")[0].props.value).toBe("https://example.test/newer");
});


it("native fallback keeps the capture identity and private visibility before acknowledging only that saved source", async () => {
  fixture.os = "ios"; fixture.nativeSharing = true;
  const capture = { captureKey: "native-A", captureId: "request-A", ownerId: fixture.owner, generation: 1,
    url: "https://instagram.com/reel/example", text: "caption", files: [], isPublic: false };
  fixture.nativeCaptures.mockResolvedValueOnce([capture]);
  await mount(ShareCapture);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "capture:1"))!)).toMatchObject({
    request_id: "request-A", source_url: capture.url, is_public: false,
  });
  expect(fixture.nativeAck).toHaveBeenCalledWith("native-A");
  expect(fixture.persist.mock.invocationCallOrder[0]).toBeLessThan(fixture.nativeAck.mock.invocationCallOrder[0]);
});

it("native server receipt persists recovery without opening Capture or starting the import again", async () => {
  fixture.nativeAck.mockImplementationOnce(async () => {
    expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "import-source-visibility:1:server-job"))!)).toBe(false);
    return true;
  });
  cache.setQueryData([fixture.owner, "imports", 1], []);
  cache.setQueryData([fixture.owner, "library"], []);
  fixture.os = "ios"; fixture.nativeSharing = true;
  fixture.nativeCaptures.mockResolvedValueOnce([{ captureKey: "native-A", captureId: "request-A", ownerId: fixture.owner,
    generation: 1, url: "https://instagram.com/reel/example", text: "", files: [], isPublic: false, jobId: "server-job" }]);
  await mount(ShareCapture);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "imports:1"))!)[0].id).toBe("server-job");
  expect(fixture.nativeAck).toHaveBeenCalledWith("native-A");
  expect(cache.getQueryState([fixture.owner, "imports", 1])?.isInvalidated).toBe(true);
  expect(cache.getQueryState([fixture.owner, "library"])?.isInvalidated).toBe(true);
  expect(fixture.push).not.toHaveBeenCalled(); expect(fixture.startImport).not.toHaveBeenCalled();
});

it("keeps a native server receipt when its private source choice cannot be saved", async () => {
  fixture.os = "ios"; fixture.nativeSharing = true; fixture.writeFailure = true;
  fixture.nativeCaptures.mockResolvedValueOnce([{ captureKey: "native-A", captureId: "request-A", ownerId: fixture.owner,
    generation: 1, url: "https://instagram.com/reel/example", text: "", files: [], isPublic: false, jobId: "server-job" }]);
  await mount(ShareCapture);
  expect(fixture.nativeAck).not.toHaveBeenCalled(); expect(fixture.startImport).not.toHaveBeenCalled();
});

it("native captures never transfer between application owners or enrollment generations", async () => {
  fixture.os = "ios"; fixture.nativeSharing = true;
  fixture.nativeCaptures.mockResolvedValue([{ captureKey: "other", ownerId: "another-owner", generation: 1 },
    { captureKey: "retired", ownerId: fixture.owner, generation: 0 }]);
  await mount(ShareCapture);
  expect(fixture.nativeAck).not.toHaveBeenCalled(); expect(fixture.push).not.toHaveBeenCalled();
  expect(fixture.map.has(draftKey(fixture.owner, "capture:1"))).toBe(false);
});

it("an advertised native PDF share becomes an owned document before its exact queue acknowledgement", async () => {
  fixture.os = "ios"; fixture.nativeSharing = true;
  fixture.nativeCaptures.mockResolvedValueOnce([{ captureKey: "pdf-capture", captureId: "pdf-request", ownerId: fixture.owner,
    generation: 1, text: "PDF caption", files: [{ path: "file:///shared/source.pdf", mimeType: "application/pdf", fileName: "Workout.pdf" }], isPublic: false }]);
  const owned = { uri: "file:///cache/hafa-workouts-capture/source.pdf", name: "Workout.pdf", mime_type: "application/pdf", owned: true };
  fixture.normalizeDocument.mockResolvedValue([owned]); await mount(ShareCapture);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "capture:1"))!)).toMatchObject({ kind: "document", files: [owned], is_public: false });
  expect(fixture.nativeAck).toHaveBeenCalledWith("pdf-capture");
  expect(fixture.persist.mock.invocationCallOrder[0]).toBeLessThan(fixture.nativeAck.mock.invocationCallOrder[0]);
});

const oversizedNativePDF = () => ({ captureKey: "oversized-pdf", captureId: "oversized-request", ownerId: fixture.owner,
  generation: 1, text: "", files: [{ path: "file:///shared/large.pdf", mimeType: "application/pdf", fileName: "Large.pdf" }], isPublic: false });
it("a rejected native PDF advances to the next receipt only after an explicit exact-source discard", async () => {
  fixture.os = "ios"; fixture.nativeSharing = true;
  fixture.normalizeDocument.mockRejectedValueOnce(Error("Documents must be 128 KB or smaller."));
  fixture.nativeCaptures.mockResolvedValueOnce([oversizedNativePDF()]).mockResolvedValueOnce([{
    captureKey: "next-receipt", captureId: "next-request", ownerId: fixture.owner, generation: 1,
    text: "", files: [], isPublic: false, jobId: "next-job",
  }]);
  await mount(ShareCapture);
  expect(fixture.nativeAck).not.toHaveBeenCalled();
  expect(fixture.nativeCaptures).toHaveBeenCalledTimes(1);
  const actions = fixture.alert.mock.calls[0][2];
  expect(actions.map((action: { text: string }) => action.text)).toEqual(["Later", "Discard shared source"]);
  await act(async () => actions[1].onPress()); await settle();
  expect(fixture.nativeAck.mock.calls.map(call => call[0])).toEqual(["oversized-pdf", "next-receipt"]);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "imports:1"))!)[0].id).toBe("next-job");
});
it("Later keeps a rejected native source without acknowledging or immediately reloading it", async () => {
  fixture.os = "ios"; fixture.nativeSharing = true;
  fixture.nativeCaptures.mockResolvedValueOnce([oversizedNativePDF()]);
  fixture.normalizeDocument.mockRejectedValueOnce(Error("Document too large"));
  await mount(ShareCapture);
  const actions = fixture.alert.mock.calls[0][2];
  await act(async () => actions[0].onPress()); await settle();
  await act(async () => actions[1].onPress()); await settle();
  expect(fixture.nativeAck).not.toHaveBeenCalled();
  expect(fixture.nativeCaptures).toHaveBeenCalledTimes(1); expect(fixture.alert).toHaveBeenCalledTimes(1);
});
it("a failed native discard retains its receipt and shows recovery without a retry loop", async () => {
  fixture.os = "ios"; fixture.nativeSharing = true;
  fixture.nativeCaptures.mockResolvedValueOnce([oversizedNativePDF()]);
  fixture.normalizeDocument.mockRejectedValueOnce(Error("Document too large")); fixture.nativeAck.mockResolvedValue(false);
  await mount(ShareCapture);
  await act(async () => fixture.alert.mock.calls[0][2][1].onPress()); await settle();
  expect(fixture.nativeAck).toHaveBeenCalledExactlyOnceWith("oversized-pdf");
  expect(fixture.alert).toHaveBeenLastCalledWith("Could not clear shared source", expect.stringContaining("still saved"));
  expect(fixture.nativeCaptures).toHaveBeenCalledTimes(1); expect(fixture.alert).toHaveBeenCalledTimes(2);
});
it("a native normalization failure arriving offscreen never acknowledges or asks to discard the source", async () => {
  fixture.os = "ios"; fixture.nativeSharing = true;
  fixture.nativeCaptures.mockResolvedValueOnce([oversizedNativePDF()]);
  const pending = deferred<import("./capture").CaptureFile[]>(); fixture.normalizeDocument.mockReturnValueOnce(pending.promise);
  await mount(ShareCapture); await unmount();
  await act(async () => pending.reject(Error("Document too large"))); await settle();
  expect(fixture.nativeAck).not.toHaveBeenCalled(); expect(fixture.alert).not.toHaveBeenCalled();
});
it.each(["account", "unmount"])("a native discard callback cannot acknowledge after %s retirement", async (retirement) => {
  fixture.os = "ios"; fixture.nativeSharing = true;
  fixture.nativeCaptures.mockResolvedValueOnce([oversizedNativePDF()]);
  fixture.normalizeDocument.mockRejectedValueOnce(Error("Document too large"));
  await mount(ShareCapture);
  const discard = fixture.alert.mock.calls[0][2][1].onPress;
  if (retirement === "account") { fixture.owner = "new-owner"; await rerender(ShareCapture); }
  else await unmount();
  await act(async () => discard()); await settle();
  expect(fixture.nativeAck).not.toHaveBeenCalled(); expect(fixture.alert).toHaveBeenCalledTimes(1);
});


it("cold restored acknowledged source opens an editable composer and retains exact source files and privacy", async () => {
  const file = { uri: "file:///cache/hafa-workouts-capture/queued.jpg", owned: true, name: "Source", mime_type: "image/jpeg" };
  const original = { request_id: "original-uuid", generation: 1, kind: "images", text: "Creator instructions", source_url: "", files: [file],
    created_at: "2026-10-14T00:00:00Z", job_id: "queued-job", pending_import: true, is_public: false };
  fixture.map.set(draftKey(fixture.owner, "capture:1"), JSON.stringify(original));
  await mount(Capture);
  expect(nodes("Field")[0].props).toMatchObject({ label: "Source link", value: "", disabled: false });
  const archiveKey = draftKey(fixture.owner, submittedCaptureScope(1, "queued-job"));
  expect(JSON.parse(fixture.map.get(archiveKey)!)).toMatchObject(original);
  expect(fixture.cleanup).not.toHaveBeenCalled();
  await click("Resume existing import");
  expect(fixture.push).toHaveBeenLastCalledWith({ pathname: "/import/[id]", params: { id: "queued-job" } });
  await act(async () => nodes("Field")[0].props.onChange("https://example.test/another")); await settle();
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "capture:1"))!).source_url).toBe("https://example.test/another");
  expect(JSON.parse(fixture.map.get(archiveKey)!)).toMatchObject(original);
});
it("a held archive write keeps the original frozen source until durable handoff and retry unlocks it", async () => {
  const original = { request_id: "held-uuid", generation: 1, kind: "url", text: "Original", source_url: "https://example.test/held", files: [],
    created_at: "2026-10-14T00:00:00Z", job_id: "held-job", pending_import: true, is_public: true };
  const key = draftKey(fixture.owner, "capture:1"), archiveKey = draftKey(fixture.owner, submittedCaptureScope(1, "held-job"));
  fixture.map.set(key, JSON.stringify(original));
  const write = deferred<void>(); let held = true;
  fixture.persist.mockImplementation(async (storedKey, value) => {
    if (storedKey === archiveKey && held) { held = false; await write.promise; }
    fixture.map.set(storedKey, value);
  });
  await mount(Capture);
  expect(nodes("Field")[0].props.disabled).toBe(true);
  expect(JSON.parse(fixture.map.get(key)!)).toMatchObject(original);
  expect(fixture.map.has(archiveKey)).toBe(false);
  await act(async () => write.reject(Error("archive unavailable"))); await settle();
  expect(JSON.parse(fixture.map.get(key)!)).toMatchObject(original);
  expect(button("Start another source draft").props.busy).toBe(false);
  await click("Start another source draft");
  expect(nodes("Field")[0].props).toMatchObject({ value: "", disabled: false });
  expect(JSON.parse(fixture.map.get(archiveKey)!)).toMatchObject(original);
  expect(fixture.cleanup).not.toHaveBeenCalled();
});
it("a held archive handoff cannot clear or expose a source after its account changes", async () => {
  const previousOwner = fixture.owner, key = draftKey(previousOwner, "capture:1");
  fixture.map.set(key, JSON.stringify({ request_id: "old", generation: 1, kind: "url", text: "Private", source_url: "https://example.test/old", files: [],
    created_at: "2026-10-14T00:00:00Z", pending_import: true, job_id: "old-job", is_public: false }));
  const archiveKey = draftKey(previousOwner, submittedCaptureScope(1, "old-job")), write = deferred<void>();
  fixture.persist.mockImplementation(async (storedKey, value) => { if (storedKey === archiveKey) await write.promise; fixture.map.set(storedKey, value); });
  await mount(Capture); fixture.current = false;
  await act(async () => write.resolve()); await settle();
  expect(fixture.map.has(key)).toBe(true);
  expect(fixture.map.has(draftKey(previousOwner, "imports:1"))).toBe(false);
  expect(fixture.cleanup).not.toHaveBeenCalled();
});

it("acknowledged imports release the composer after each request without losing either original source", async () => {
  fixture.startImport.mockResolvedValueOnce({ id: "first-job" }).mockResolvedValueOnce({ id: "second-job" });
  await mount(Capture);
  for (const url of ["https://example.test/first", "https://example.test/second"]) {
    await act(async () => nodes("Field")[0].props.onChange(url)); await settle();
    await click("Extract workout");
    expect(nodes("Field")[0].props).toMatchObject({ value: "", disabled: false });
  }
  const first = JSON.parse(fixture.map.get(draftKey(fixture.owner, submittedCaptureScope(1, "first-job")))!);
  const second = JSON.parse(fixture.map.get(draftKey(fixture.owner, submittedCaptureScope(1, "second-job")))!);
  expect(first.source_url).toBe("https://example.test/first");
  expect(second.source_url).toBe("https://example.test/second");
  expect(first.request_id).not.toBe(second.request_id);
  expect(fixture.startImport.mock.calls[0][0]).toBe(first.request_id);
  expect(fixture.startImport.mock.calls[1][0]).toBe(second.request_id);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "imports:1"))!).map((item: { id: string }) => item.id)).toEqual(["second-job", "first-job"]);
  await click("Resume existing import");
  expect(fixture.push).toHaveBeenLastCalledWith({ pathname: "/import/[id]", params: { id: "second-job" } });
});

it("a mounted failed handoff can start a new source after import review safely retires the original", async () => {
  const key = draftKey(fixture.owner, "capture:1");
  fixture.map.set(key, JSON.stringify({ request_id: "finished", generation: 1, kind: "url", source_url: "https://example.test/finished", text: "", files: [],
    created_at: "2026-10-14T00:00:00Z", pending_import: true, job_id: "finished-job" }));
  let failArchive = true, reviewing = false;
  fixture.persist.mockImplementation(async (storedKey, value) => {
    if (failArchive && storedKey.includes("submitted%3A")) { failArchive = false; throw Error("archive unavailable"); }
    fixture.map.set(storedKey, value);
  });
  fixture.params = { id: "finished-job" }; fixture.cancelImport.mockResolvedValue(undefined);
  fixture.importJob.mockResolvedValue({ id: "finished-job", generation: 1, status: "processing" });
  const journey = () => createElement(Fragment, null, createElement(Capture), reviewing && createElement(ImportReview));
  await mount(journey);
  expect(nodes("Field")[0].props.disabled).toBe(true);
  reviewing = true; await rerender(journey); await click("Cancel import and clear source upload");
  reviewing = false; await rerender(journey);
  expect(fixture.map.has(key)).toBe(false);
  await click("Start another source draft");
  expect(nodes("Field")[0].props).toMatchObject({ value: "", disabled: false });
});


const unfinishedNativeDraft = () => ({ request_id: "unfinished-A", generation: 1, kind: "images", source_url: "", text: "My source A", is_public: false,
  files: [{ uri: "file:///cache/hafa-workouts-capture/draft-A.jpg", name: "A", mime_type: "image/jpeg", owned: true }], created_at: "2026-10-14T00:00:00Z" });
const queuedNativeSource = () => ({ captureKey: "queued-B", captureId: "source-B", ownerId: fixture.owner, generation: 1, text: "Shared source B", isPublic: false,
  files: [{ path: "file:///shared/source-B.jpg", mimeType: "image/jpeg", fileName: "B" }] });
it("native deferred sharing keeps both sources, continues the current draft and retries on a later foreground", async () => {
  const current = unfinishedNativeDraft(), incoming = queuedNativeSource(), key = draftKey(fixture.owner, "capture:1");
  fixture.map.set(key, JSON.stringify(current)); fixture.os = "ios"; fixture.nativeSharing = true;
  fixture.nativeCaptures.mockResolvedValueOnce([incoming]).mockResolvedValueOnce([incoming]);
  await mount(overlappingCapture);
  expect(fixture.alert).toHaveBeenCalledWith("Shared source saved for later", expect.stringContaining("both saved"), expect.any(Array), expect.anything());
  expect(fixture.normalizeImages).not.toHaveBeenCalled(); expect(fixture.nativeAck).not.toHaveBeenCalled();
  expect(JSON.parse(fixture.map.get(key)!)).toMatchObject(current);
  const actions = fixture.alert.mock.calls[0][2];
  expect(actions.map((action: { text: string }) => action.text)).toEqual(["Later", "Continue current draft"]);
  await act(async () => actions[1].onPress()); await settle();
  expect(fixture.push).toHaveBeenLastCalledWith("/capture");
  expect(fixture.nativeCaptures).toHaveBeenCalledTimes(1); expect(fixture.cleanup).not.toHaveBeenCalled();
  fixture.startImport.mockResolvedValueOnce({ id: "source-A-job" }); await click("Extract workout");
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, submittedCaptureScope(1, "source-A-job")))!)).toMatchObject(current);
  const clonedB = { uri: "file:///cache/hafa-workouts-capture/intake-B.jpg", name: "B", mime_type: "image/jpeg", owned: true };
  fixture.normalizeImages.mockResolvedValueOnce([clonedB]);
  await act(async () => { for (const listener of fixture.foreground) listener("active"); }); await settle();
  expect(fixture.nativeAck).toHaveBeenCalledExactlyOnceWith("queued-B");
  expect(JSON.parse(fixture.map.get(key)!)).toMatchObject({ request_id: "source-B", files: [clonedB] });
  expect(fixture.cleanup.mock.calls.flatMap(call => call[0])).not.toContainEqual(current.files[0]);
});
it("Later preserves a deferred native receipt without immediately reloading or prompting again", async () => {
  const current = unfinishedNativeDraft(), key = draftKey(fixture.owner, "capture:1");
  fixture.map.set(key, JSON.stringify(current)); fixture.os = "ios"; fixture.nativeSharing = true;
  fixture.nativeCaptures.mockResolvedValueOnce([queuedNativeSource()]); await mount(ShareCapture);
  const actions = fixture.alert.mock.calls[0][2]; await act(async () => actions[0].onPress()); await settle();
  await act(async () => actions[1].onPress()); await settle();
  expect(fixture.nativeAck).not.toHaveBeenCalled(); expect(fixture.push).not.toHaveBeenCalled();
  expect(fixture.nativeCaptures).toHaveBeenCalledTimes(1); expect(fixture.alert).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fixture.map.get(key)!)).toMatchObject(current);
});
it("a draft arriving during native normalization retains both sources and cleans only the new intake copies", async () => {
  fixture.os = "ios"; fixture.nativeSharing = true; fixture.nativeCaptures.mockResolvedValueOnce([queuedNativeSource()]);
  const held = deferred<import("./capture").CaptureFile[]>(); fixture.normalizeImages.mockReturnValueOnce(held.promise);
  await mount(ShareCapture);
  const current = unfinishedNativeDraft(), key = draftKey(fixture.owner, "capture:1");
  fixture.map.set(key, JSON.stringify(current));
  const clone = { uri: "file:///cache/hafa-workouts-capture/normalized-B.jpg", name: "B", mime_type: "image/jpeg", owned: true };
  await act(async () => held.resolve([clone])); await settle();
  expect(fixture.cleanup).toHaveBeenCalledExactlyOnceWith([clone], true);
  expect(JSON.parse(fixture.map.get(key)!)).toMatchObject(current);
  expect(fixture.nativeAck).not.toHaveBeenCalled();
  expect(fixture.alert.mock.calls[0][0]).toBe("Shared source saved for later");
});
it.each(["account", "unmount"])("deferred native source callbacks stay inert after %s retirement", async (retirement) => {
  const current = unfinishedNativeDraft(), originalOwner = fixture.owner;
  fixture.map.set(draftKey(originalOwner, "capture:1"), JSON.stringify(current)); fixture.os = "ios"; fixture.nativeSharing = true;
  fixture.nativeCaptures.mockResolvedValueOnce([queuedNativeSource()]); await mount(ShareCapture);
  const actions = fixture.alert.mock.calls[0][2];
  if (retirement === "account") { fixture.owner = "replacement-owner"; await rerender(ShareCapture); }
  else await unmount();
  await act(async () => { actions[1].onPress(); actions[0].onPress(); }); await settle();
  expect(fixture.nativeAck).not.toHaveBeenCalled(); expect(fixture.push).not.toHaveBeenCalled();
  expect(JSON.parse(fixture.map.get(draftKey(originalOwner, "capture:1"))!)).toMatchObject(current);
});
it("retrying a registered native capture only acknowledges its receipt without copying or replacing user changes", async () => {
  const current = { ...unfinishedNativeDraft(), request_id: "source-B", is_public: true, text: "My updated instructions" };
  const key = draftKey(fixture.owner, "capture:1"); fixture.map.set(key, JSON.stringify(current));
  fixture.os = "ios"; fixture.nativeSharing = true; fixture.nativeCaptures.mockResolvedValueOnce([queuedNativeSource()]);
  await mount(ShareCapture);
  expect(fixture.nativeAck).toHaveBeenCalledExactlyOnceWith("queued-B"); expect(fixture.normalizeImages).not.toHaveBeenCalled();
  expect(fixture.cleanup).not.toHaveBeenCalled(); expect(fixture.alert).not.toHaveBeenCalled();
  expect(JSON.parse(fixture.map.get(key)!)).toMatchObject(current);
});

it("retries retained source with caption privately and reconnects the exact request after a transport failure", async () => {
  fixture.params = { id: "job-A" };
  fixture.capabilities.mockResolvedValue(serverCaps);
  fixture.importJob.mockResolvedValue({ id: "job-A", generation: 1, status: "failed", result: null });
  fixture.importSource.mockResolvedValue({ kind: "url", source_url: "https://example.test/workout", text: "Original instructions", ai_consent: true });
  fixture.startImport.mockRejectedValueOnce(Error("Connection interrupted"));
  fixture.startImport.mockResolvedValueOnce({ id: "retry-job", generation: 1, status: "queued" });
  await mount(ImportReview);
  await act(async () => nodes("Field").find(node => node.props.label === "Caption or source instructions")!.props.onChange("Squat 10 reps for 20 minutes"));
  await click("Retry with this caption");
  const first = fixture.startImport.mock.calls[0];
  expect(first).toEqual([expect.any(String), { kind: "url", source_url: "https://example.test/workout", text: "Original instructions\n\nSquat 10 reps for 20 minutes", ai_consent: true }, 1, { auto_save: true, is_public: false }]);
  await unmount(); await mount(ImportReview); await click("Reconnect retry");
  expect(fixture.startImport.mock.calls[1]).toEqual(first);
  expect(fixture.map.get(draftKey(fixture.owner, "import-visibility:1:retry-job"))).toBe("false");
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "imports:1"))!)[0].id).toBe("retry-job");
  expect(fixture.replace).toHaveBeenCalledWith({ pathname: "/import/[id]", params: { id: "retry-job" } });
  expect(fixture.cancelImport).not.toHaveBeenCalled();
});

it("retries a saved source draft from its link without editing the original library workout", async () => {
  fixture.params = { id: "job-A" };
  fixture.capabilities.mockResolvedValue(serverCaps);
  fixture.importJob.mockResolvedValue({ id: "job-A", generation: 1, status: "incomplete", accepted_workout_id: "saved-original", result: {
    workout: { ...workout, blocks: [], source_url: "https://example.test/source" },
    warnings: ["Missing exercises"], evidence: [], source: { platform: "web", url: "https://example.test/source", channels: [], coverage_notes: [] }
  } });
  fixture.importSource.mockRejectedValue(new ApiError("Source cleared after saving", 410));
  fixture.startImport.mockResolvedValue({ id: "retry-job", generation: 1, status: "queued" });
  await mount(ImportReview); await click("Retry this source");
  expect(fixture.startImport).toHaveBeenCalledWith(expect.any(String), { kind: "url", source_url: "https://example.test/source", ai_consent: true }, 1, { auto_save: true, is_public: false });
  expect(fixture.updateWorkout).not.toHaveBeenCalled(); expect(fixture.acceptImport).not.toHaveBeenCalled();
});

it("cancellation removes its reference and keeps the next source import", async () => {
  fixture.params = { id: "job-A" };
  fixture.map.set(draftKey(fixture.owner, "imports:1"), JSON.stringify([{ id: "job-A" }, { id: "job-B" }]));
  fixture.cancelImport.mockResolvedValue(undefined);
  await mount(ImportReview); await click("Cancel import and clear source upload");
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "imports:1"))!)).toEqual([{ id: "job-B" }]);
});

it("stops source recovery when the account changes during source retrieval", async () => {
  fixture.params = { id: "job-A" }; fixture.capabilities.mockResolvedValue(serverCaps);
  fixture.importJob.mockResolvedValue({ id: "job-A", generation: 1, status: "failed", result: null });
  const held = deferred<{ kind: string; ai_consent: boolean; text: string }>();
  fixture.importSource.mockReturnValue(held.promise);
  await mount(ImportReview); await click("Retry this source");
  fixture.current = false; await act(async () => held.resolve({ kind: "text", text: "Squat 10 reps", ai_consent: true })); await settle();
  expect(fixture.startImport).not.toHaveBeenCalled();
});

it("restores caption recovery input after leaving an unfinished source", async () => {
  fixture.params = { id: "job-A" }; fixture.capabilities.mockResolvedValue(serverCaps);
  fixture.importJob.mockResolvedValue({ id: "job-A", generation: 1, status: "failed", result: null });
  await mount(ImportReview);
  await act(async () => nodes("Field").find(node => node.props.label === "Caption or source instructions")!.props.onChange("Squat 10 reps"));
  await settle(); await unmount(); await mount(ImportReview);
  expect(nodes("Field").find(node => node.props.label === "Caption or source instructions")!.props.value).toBe("Squat 10 reps");
});

it("recovers a saved empty source privately without replacing the original workout or capture composer", async () => {
  fixture.params = { id: "workout" }; fixture.capabilities.mockResolvedValue(serverCaps);
  fixture.workout.mockResolvedValue({ ...workout, source_url: "https://example.test/source", blocks: [] });
  const originalCapture = JSON.stringify({ request_id: "another-source", generation: 1, kind: "text", text: "Unfinished source", files: [] });
  fixture.map.set(draftKey(fixture.owner, "capture:1"), originalCapture);
  fixture.startImport.mockResolvedValue({ id: "recovery-job", generation: 1, status: "queued" });
  await mount(RecoverWorkout);
  expect(nodes("Field").find(node => node.props.label === "Original source link")!.props.value).toBe("https://example.test/source");
  await act(async () => nodes("Field").find(node => node.props.label === "Creator caption or transcript")!.props.onChange("10 squats for 20 minutes"));
  await click("Recover as a private import");
  expect(fixture.startImport).toHaveBeenCalledWith(expect.any(String), { kind: "url", source_url: "https://example.test/source", text: "10 squats for 20 minutes", ai_consent: true }, 1, { auto_save: true, is_public: false });
  expect(fixture.map.get(draftKey(fixture.owner, "capture:1"))).toBe(originalCapture);
  expect(fixture.updateWorkout).not.toHaveBeenCalled(); expect(fixture.acceptImport).not.toHaveBeenCalled();
  expect(fixture.replace).toHaveBeenCalledWith({ pathname: "/import/[id]", params: { id: "recovery-job" } });
  await unmount(); await mount(RecoverWorkout);
  expect(button("Open recovery import")).toBeDefined(); expect(fixture.startImport).toHaveBeenCalledTimes(1);
});

it("reconnects the exact private recovery request after remount even when saving capabilities change", async () => {
  fixture.params = { id: "workout" }; fixture.capabilities.mockResolvedValue(serverCaps);
  fixture.workout.mockResolvedValue({ ...workout, source_url: "https://example.test/source", blocks: [] });
  fixture.startImport.mockRejectedValueOnce(Error("Lost acknowledgement"));
  await mount(RecoverWorkout); await click("Recover as a private import");
  const original = fixture.startImport.mock.calls[0]; await unmount();
  fixture.capabilities.mockResolvedValue({ ...serverCaps, server_auto_save: false });
  fixture.startImport.mockResolvedValue({ id: "recovered-job", generation: 1, status: "queued" });
  await mount(RecoverWorkout); expect(nodes("Field")[0].props.disabled).toBe(true); await click("Reconnect recovery");
  expect(fixture.startImport.mock.calls[1]).toEqual(original);
});

it("does not silently restore revoked AI consent while recovering an existing source", async () => {
  fixture.params = { id: "workout" }; fixture.capabilities.mockResolvedValue(serverCaps);
  fixture.workout.mockResolvedValue({ ...workout, source_url: "https://example.test/source" });
  fixture.aiConsent.mockResolvedValueOnce({ accepted: true, disclosure_version: 1 }).mockResolvedValue({ accepted: false, disclosure_version: 1 });
  await mount(RecoverWorkout); await click("Recover as a private import");
  expect(fixture.setAiConsent).not.toHaveBeenCalled(); expect(fixture.startImport).not.toHaveBeenCalled();
  expect(button("Agree and recover privately")).toBeDefined();
});

it("an old recovery cannot send after route A to B to A reuse", async () => {
  fixture.params = { id: "workout" }; fixture.capabilities.mockResolvedValue(serverCaps);
  fixture.workout.mockResolvedValue({ ...workout, source_url: "https://example.test/source" });
  const held = deferred<{ accepted: boolean; disclosure_version: number }>();
  fixture.aiConsent.mockResolvedValueOnce({ accepted: true, disclosure_version: 1 }).mockReturnValueOnce(held.promise).mockResolvedValue({ accepted: true, disclosure_version: 1 });
  await mount(RecoverWorkout); await click("Recover as a private import");
  fixture.params = { id: "other" }; await rerender(RecoverWorkout);
  fixture.params = { id: "workout" }; await rerender(RecoverWorkout);
  await act(async () => held.resolve({ accepted: true, disclosure_version: 1 })); await settle();
  expect(fixture.startImport).not.toHaveBeenCalled();
});

it("keeps cached import progress and offers reconnect when a status refresh loses connection", async () => {
  fixture.params = { id: "job-A" };
  const job = { id: "job-A", generation: 1, status: "processing", attempt_count: 2 };
  cache.setQueryData([fixture.owner, "import", "job-A", 1], job);
  fixture.importJob.mockRejectedValue(Error("Network unavailable"));
  await mount(ImportReview);
  expect(nodes("QueryState")[0].props.error).toBeNull();
  expect(button("Reconnect to check progress")).toBeDefined();
  expect(JSON.stringify(renderer!.toJSON())).toContain("Could not refresh progress");
  fixture.importJob.mockResolvedValue(job); await click("Reconnect to check progress");
  expect(button("Refresh import status")).toBeDefined(); expect(fixture.cancelImport).not.toHaveBeenCalled();
});

it("keeps an empty extraction in source recovery until exercises are added", async () => {
  fixture.params = { id: "empty-job" };
  fixture.capabilities.mockResolvedValue(serverCaps);
  fixture.importJob.mockResolvedValue({ id: "empty-job", generation: 1, status: "incomplete", result: {
    workout: { ...workout, blocks: [], source_url: "https://example.test/source" },
    warnings: ["Extraction was unavailable"], evidence: [], source: { platform: "web", url: "https://example.test/source", channels: [], coverage_notes: [] }
  } });
  await mount(ImportReview);
  expect(nodes("Button").some(node => node.props.title === "Save workout")).toBe(false);
  expect(button("Retry this source")).toBeDefined();
  await click("Add exercises manually");
  await act(async () => nodes("WorkoutEditor")[0].props.onChange(workout));
  await settle();
  expect(button("Save workout")).toBeDefined();
  expect(fixture.acceptImport).not.toHaveBeenCalled();
});

it.each(["caption cleanup", "navigation"])("reopens an acknowledged retry after %s fails without submitting another import", async failure => {
  fixture.params = { id: "job-A" };
  fixture.capabilities.mockResolvedValue(serverCaps);
  fixture.importJob.mockResolvedValue({ id: "job-A", generation: 1, status: "failed", result: null });
  fixture.importSource.mockResolvedValue({ kind: "text", text: "Squat 10 reps", ai_consent: true });
  fixture.startImport.mockResolvedValue({ id: "existing-retry", generation: 1, status: "queued" });
  if (failure === "caption cleanup") fixture.removeFailureScope = "import-retry-caption:1:job-A";
  else fixture.replace.mockImplementationOnce(() => { throw Error("navigation interrupted"); });
  await mount(ImportReview); await click("Retry this source");
  expect(fixture.startImport).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "import-retry:1:job-A"))!)).toMatchObject({ saved_id: "existing-retry", request_id: fixture.startImport.mock.calls[0][0] });
  await unmount(); fixture.removeFailureScope = "";
  fixture.capabilities.mockResolvedValue({ ...serverCaps, imports: false });
  await mount(ImportReview);
  expect(button("Open retry import").props.disabled).toBe(false);
  await click("Open retry import");
  expect(fixture.startImport).toHaveBeenCalledTimes(1);
  expect(fixture.replace).toHaveBeenLastCalledWith({ pathname: "/import/[id]", params: { id: "existing-retry" } });
});

it("explains a usage limit without blaming an available source caption", async () => {
  fixture.params = { id: "limit-job" };
  fixture.importJob.mockResolvedValue({ id: "limit-job", generation: 1, status: "incomplete", result: {
    error_code: "workouts_ai_budget_exceeded", workout: { ...workout, blocks: [] },
    warnings: ["Source extraction could not finish"], evidence: [], source: { platform: "text", channels: [], coverage_notes: [] }
  } });
  await mount(ImportReview);
  const view = JSON.stringify(renderer!.toJSON());
  expect(view).toContain("usage limit"); expect(view).not.toContain("Source extraction could not finish");
  expect(button("Add exercises manually")).toBeDefined();
  expect(nodes("Button").some(node => node.props.title === "Save workout")).toBe(false);
});

it("keeps legacy notes private until the owner explicitly moves them to shared instructions", async () => {
  await mountRealWorkoutEditor({ ...workout, notes: ["Old caption or private note"], instructions: undefined });
  expect(nodes("Field").find(n => n.props.label === "Workout instructions · included when sharing")!.props.value).toBe("");
  expect(nodes("Field").find(n => n.props.label === "Private notes · only you")!.props.value).toBe("Old caption or private note");
  expect(fixture.updateWorkout).not.toHaveBeenCalled();
  await click("Move private notes to shared instructions");
  expect(fixture.updateWorkout.mock.lastCall![0]).toMatchObject({ instructions: ["Old caption or private note"], notes: [] });
});


it.each(["instructions", "notes"] as const)("shows oversized exercise %s immediately for correction", async field => {
  const oversized = "x".repeat(2001);
  await mountRealWorkoutEditor({ ...workout, blocks: [{ ...workout.blocks[0], exercises: [{ name: "Row", [field]: oversized }] }] });
  const label = field === "instructions" ? "Instructions or cues · included when sharing" : "Private exercise notes · only you";
  const input = nodes("Field").find(n => n.props.label === label)!;
  expect(input.props.value).toBe(oversized);
  await act(async () => input.props.onChange("Keep this cue"));
  expect(fixture.updateWorkout.mock.lastCall![0].blocks[0].exercises[0][field]).toBe("Keep this cue");
});

it.each(["instructions", "notes"] as const)("keeps oversized workout %s editable until repaired before freezing creation", async field => {
  await mount(AddWorkout);
  const editor = () => nodes("WorkoutEditor")[0];
  await act(async () => editor().props.onChange({ ...editor().props.value, title: "Repair me", [field]: ["x".repeat(4001)],
    blocks: [{ id: "main", label: "Main", grouping: "sequential", exercises: [{ name: "Row" }] }] }));
  await click("Save to my library");
  expect(fixture.saveWorkout).not.toHaveBeenCalled();
  expect(editor().props.disabled).toBe(false);
  expect(JSON.parse(fixture.map.get(draftKey(fixture.owner, "manual-workout:1"))!).command).toBeNull();
  await act(async () => editor().props.onChange({ ...editor().props.value, [field]: ["Rest as needed"] }));
  fixture.saveWorkout.mockResolvedValueOnce(workout);
  await click("Save to my library");
  expect(fixture.saveWorkout.mock.calls[0][0][field]).toEqual(["Rest as needed"]);
});
