import { beforeEach, it, expect, vi } from "vitest";
import { captureErrors, boundedSource, importIsTerminal, archiveCapturedImport, loadCapturedImport, submittedCaptureScope, retireCapturedImport, type CaptureDraft } from "./capture";
import { createPrivateDraftSlot } from "./private-form";
import { filterLibrary, workoutErrors, editedContent } from "./library";
import { authoredWorkout } from "./api";
import { isISODate, publicShareReader } from "./sharing";
const native = vi.hoisted(() => ({
  files: new Map<string, string>(),
  records: new Map<string, string>(),
  nativeProcess: "native-process-one",
  platform: "android",
  normalizeCaptureImage: vi.fn(),
  recordSet: vi.fn(),
  recordRemove: vi.fn(),
  next: 0,
  picker: vi.fn(),
  document: vi.fn(),
  manipulate: vi.fn(),
  copy: vi.fn(),
  remove: vi.fn(),
  read: vi.fn(),
  size: 100
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => native.records.get(key) ?? null,
    setItem: native.recordSet,
    removeItem: native.recordRemove,
    getAllKeys: async () => [...native.records.keys()]
  }
}));
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: (name: string) => name === "HafaWorkoutsShare"
    ? { normalizeCaptureImage: native.normalizeCaptureImage }
    : { nativeProcessIdentity: () => native.nativeProcess }
}));
vi.mock("react-native", () => ({ Platform: { get OS() { return native.platform; } } }));
vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: native.picker,
  launchCameraAsync: native.picker,
  requestCameraPermissionsAsync: async () => ({ granted: true })
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: native.document }));
vi.mock("expo-image-manipulator", () => ({ manipulateAsync: native.manipulate, SaveFormat: { JPEG: "jpeg" } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `operation-${++native.next}` }));
vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  makeDirectoryAsync: async () => {},
  copyAsync: native.copy,
  deleteAsync: native.remove,
  readAsStringAsync: native.read,
  getInfoAsync: async (uri: string) => ({ exists: native.files.has(uri), isDirectory: false, size: native.size }),
  EncodingType: { Base64: "base64" }
}));
import { normalizeImages, normalizeDocument, pickImages, pickDocument, sourceFor, recoverCaptureCleanup, cleanupCaptureFiles } from "./capture-io";
import { createPrivateStorageRegistry } from "./private-storage";
import { createCaptureCleanupJournal } from "./capture-cleanup";
import { draftKey } from "./drafts";
const journalStorage = () => ({
  getItem: async (key: string) => native.records.get(key) ?? null,
  setItem: native.recordSet,
  removeItem: native.recordRemove,
  getAllKeys: async () => [...native.records.keys()]
});
const restartedJournal = () =>
  createCaptureCleanupJournal(
    journalStorage(),
    () => "file:///cache/",
    (uri) => native.remove(uri),
    async () => native.nativeProcess
  );
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  native.nativeProcess = "native-process-one";
  native.platform = "android";
  native.files.clear();
  native.records.clear();
  native.next = 0;
  native.size = 100;
  vi.clearAllMocks();
  native.normalizeCaptureImage.mockImplementation(async (_source, destination) => { native.files.set(destination, "normalized"); });
  native.recordSet.mockImplementation(async (key: string, value: string) => {
    native.records.set(key, value);
  });
  native.recordRemove.mockImplementation(async (key: string) => {
    native.records.delete(key);
  });
  native.copy.mockImplementation(async ({ from, to }: { from: string; to: string }) => {
    if (!native.files.has(from)) throw Error("Missing source");
    native.files.set(to, native.files.get(from)!);
  });
  native.remove.mockImplementation(async (uri: string) => {
    native.files.delete(uri);
  });
  native.read.mockImplementation(async (uri: string) => native.files.get(uri));
  native.manipulate.mockImplementation(async () => {
    const uri = `file:///cache/ImageManipulator/${++native.next}.jpg`;
    native.files.set(uri, "normalized");
    return { uri, base64: "AAAA", width: 900, height: 900 };
  });
});
const draft: CaptureDraft = {
  request_id: "owned-request",
  generation: 3,
  kind: "url",
  source_url: "https://example.test/workout",
  text: "",
  files: [],
  created_at: "2026-10-10T00:00:00Z"
};
it("journals each iOS image destination before its native writer starts", async () => {
  native.platform = "ios";
  const original = "file:///shared/original.png"; native.files.set(original, "Original");
  native.normalizeCaptureImage.mockImplementation(async (source, destination) => {
    const record = [...native.records.values()].map(raw => JSON.parse(raw))[0];
    expect(record).toMatchObject({ state: "open", nativeKind: "known" });
    expect(record.assets).toContainEqual({ uri: destination, kind: "capture" });
    expect(source).toBe(original); native.files.set(destination, "Normalized");
  });
  const files = await normalizeImages([{ uri: original, name: "Source.png" }], () => {}, "ios-owner");
  expect(files[0]).toMatchObject({ owned: true, mime_type: "image/jpeg", name: "Source.png" });
  expect(native.files.get(files[0].uri)).toBe("Normalized");
  expect(native.files.get(original)).toBe("Original");
  expect(native.manipulate).not.toHaveBeenCalled(); expect(native.copy).not.toHaveBeenCalled();
});
it("cold-process recovery removes an interrupted iOS image write without unknown SDK files", async () => {
  native.platform = "ios";
  const entered = deferred<void>(), neverFinishes = deferred<void>();
  const original = "file:///shared/original.png", other = "file:///cache/hafa-workouts-capture/other.jpg";
  native.files.set(original, "Original"); native.files.set(other, "Other account");
  let destination = "";
  native.normalizeCaptureImage.mockImplementation(async (_source, target) => {
    destination = target; native.files.set(target, "Partial write"); entered.resolve();
    await neverFinishes.promise;
  });
  void normalizeImages([{ uri: original }], () => {}, "ios-owner").catch(() => undefined);
  await entered.promise;
  await expect(restartedJournal().recover("ios-owner")).rejects.toThrow("still finishing");
  expect(native.files.has(destination)).toBe(true);
  native.nativeProcess = "native-process-two";
  await restartedJournal().recover("ios-owner");
  expect(native.files.has(destination)).toBe(false);
  expect([...native.files.keys()]).toEqual([original, other]); expect(native.records.size).toBe(0);
});
it("preserves the source and retires exact iOS outputs when native conversion fails", async () => {
  native.platform = "ios";
  const original = "file:///shared/original.png", other = "file:///cache/hafa-workouts-capture/other.jpg";
  native.files.set(original, "Original"); native.files.set(other, "Other account");
  native.normalizeCaptureImage.mockImplementation(async (_source, destination) => {
    native.files.set(destination, "Partial write");
    throw Error("That workout image could not be converted. Choose another image.");
  });
  await expect(normalizeImages([{ uri: original }], () => {}, "ios-owner")).rejects.toThrow("could not be converted");
  expect([...native.files.keys()]).toEqual([original, other]); expect(native.records.size).toBe(0);
  expect(native.manipulate).not.toHaveBeenCalled(); expect(native.copy).not.toHaveBeenCalled();
});
it("copies a shared PDF into the owner journal without consuming its borrowed extension original", async () => {
  const uri = "file:///shared/workout.pdf"; native.files.set(uri, "PDF contents");
  const files = await normalizeDocument({ uri, mimeType: "application/pdf", name: "Workout.pdf" }, () => {}, "document-owner");
  expect(files[0]).toMatchObject({ mime_type: "application/pdf", name: "Workout.pdf", owned: true });
  expect(files[0].uri).toContain("hafa-workouts-capture/");
  expect(native.files.get(files[0].uri)).toBe("PDF contents"); expect(native.files.get(uri)).toBe("PDF contents");
});
it("rejects oversized and unsupported shared documents before creating owned bytes", async () => {
  const uri = "file:///shared/workout.pdf"; native.files.set(uri, "PDF"); native.size = 128 * 1024 + 1;
  await expect(normalizeDocument({ uri, mimeType: "application/pdf", name: "Workout.pdf" }, () => {}, "owner")).rejects.toThrow("under 128 KB");
  await expect(normalizeDocument({ uri, mimeType: "video/mp4", name: "video.mp4" }, () => {}, "owner")).rejects.toThrow("PDF or text");
  expect(native.copy).not.toHaveBeenCalled(); expect(native.files.has(uri)).toBe(true);
});
it("a completed import cannot clear a newer source while its temporary file deletion finishes", async () => {
  const owner = "completed-owner", storage = journalStorage();
  const slot = createPrivateDraftSlot<CaptureDraft>(storage, owner, "capture:1", () => `revision-${++native.next}`);
  const original = "file:///cache/hafa-workouts-capture/A.pdf", newer = "file:///cache/hafa-workouts-capture/B.pdf";
  native.files.set(original, "A"); native.files.set(newer, "B");
  await slot.save(null, { ...draft, generation: 1, job_id: "job-A", files: [{ uri: original, mime_type: "application/pdf", name: "A", owned: true }] }, () => {});
  const held = deferred<void>();
  native.remove.mockImplementation(async uri => { if (uri === original) await held.promise; native.files.delete(uri); });
  const pending = retireCapturedImport(storage, owner, 1, "job-A", () => {}, cleanupCaptureFiles, () => `revision-${++native.next}`);
  while (!native.remove.mock.calls.length) await new Promise(resolve => setTimeout(resolve, 0));
  const retired = await slot.load(() => {});
  await slot.save(retired.revision, { ...draft, request_id: "B", generation: 1, source_url: "https://example.test/B",
    files: [{ uri: newer, mime_type: "application/pdf", name: "B", owned: true }], cleanup_files: retired.value!.cleanup_files }, () => {});
  held.resolve(); await pending;
  expect((await slot.load(() => {})).value?.request_id).toBe("B"); expect(native.files.has(newer)).toBe(true); expect(native.files.has(original)).toBe(false);
});
it("a completed import retains exact cleanup references when deletion fails and retries them safely", async () => {
  const owner = "cleanup-owner", storage = journalStorage();
  const slot = createPrivateDraftSlot<CaptureDraft>(storage, owner, "capture:1", () => `revision-${++native.next}`);
  const file = { uri: "file:///cache/hafa-workouts-capture/import.pdf", mime_type: "application/pdf", name: "PDF", owned: true };
  native.files.set(file.uri, "PDF"); await slot.save(null, { ...draft, generation: 1, job_id: "job", files: [file] }, () => {});
  native.remove.mockRejectedValueOnce(Error("file locked"));
  await expect(retireCapturedImport(storage, owner, 1, "job", () => {}, cleanupCaptureFiles, () => `revision-${++native.next}`)).rejects.toThrow("file locked");
  expect((await slot.load(() => {})).value).toMatchObject({ files: [], cleanup_files: [file] });
  await retireCapturedImport(storage, owner, 1, "job", () => {}, cleanupCaptureFiles, () => `revision-${++native.next}`);
  expect((await slot.load(() => {})).value).toBeNull(); expect(native.files.has(file.uri)).toBe(false);
});
it("validates between-round rest without turning unknown rest into zero", () => {
  const workout = { title: "Circuit", kind: "session" as const, provenance: "source" as const,
    blocks: [{ id: "main", label: "Main", grouping: "circuit" as const, rest_between_rounds_seconds: -1, exercises: [] }] };
  expect(workoutErrors(workout)).toContain("Rest between rounds must be whole seconds from 0 to 7200, or blank.");
  expect(workoutErrors({ ...workout, blocks: [{ ...workout.blocks[0], rest_between_rounds_seconds: null }] })).toEqual([]);
});
it("rejects credentialed/non-web sources and preserves optional captions", () => {
  expect(captureErrors(draft)).toEqual([]);
  expect(captureErrors({ ...draft, source_url: "https://private:secret@example.test/workout" })).toHaveLength(1);
  expect(captureErrors({ ...draft, source_url: "file:///private/workout" })).toHaveLength(1);
  expect(
    boundedSource({ kind: "url", source_url: draft.source_url, text: "Three rounds, each side", ai_consent: true }).text
  ).toBe("Three rounds, each side");
});
it("bounds image counts and source payload bytes without inventing missing prescriptions", () => {
  expect(captureErrors({ ...draft, kind: "images", files: [] })).toHaveLength(1);
  expect(captureErrors({ ...draft, kind: "text", text: "x".repeat(30001) })).toHaveLength(1);
  expect(() => boundedSource({ kind: "text", text: "x".repeat(4 * 1024 * 1024), ai_consent: true })).toThrow(
    "too large"
  );
  expect(importIsTerminal("incomplete")).toBe(true);
  expect(importIsTerminal("processing")).toBe(false);
});
it("treats user edits as authored versions and rejects reversed rep ranges", () => {
  const content = {
    title: "Dumbbell session",
    kind: "session" as const,
    provenance: "suggestion" as const,
    equipment_required: ["dumbbells"],
    blocks: [
      {
        id: "main",
        label: "Main",
        grouping: "sequential" as const,
        exercises: [{ name: "Row", provenance: "suggestion" as const, reps_min: 10, reps_max: 8 }]
      }
    ]
  };
  const edited = editedContent(content);
  expect(edited.provenance).toBe("user");
  expect(edited.blocks[0].exercises[0].provenance).toBe("user");
  expect(content.provenance).toBe("suggestion");
  expect(workoutErrors(edited)).toContain("Row: minimum reps cannot exceed maximum reps.");
  expect(
    filterLibrary([{ ...edited, id: "owned", revision: 1, generation: 3 }], "row", "dumbbells", "session")
  ).toHaveLength(1);
});
it("rejects rollover calendar dates for recipient program copies", () => {
  expect(isISODate("2026-02-31")).toBe(false);
  expect(isISODate("2026-10-10")).toBe(true);
});
it("validates editable workout duration and instruction bounds before freezing a save", () => {
  const workout = { title: "Circuit", kind: "session" as const, provenance: "user" as const, blocks: [] };
  expect(workoutErrors({ ...workout, estimated_minutes: 20, notes: Array(100).fill("Rest as needed") }, true)).toEqual([]);
  expect(workoutErrors({ ...workout, estimated_minutes: 20.5 }, true)).toContain("Estimated duration must be whole minutes from 1 to 1440, or blank.");
  expect(workoutErrors({ ...workout, estimated_minutes: NaN }, true)).toHaveLength(1);
  expect(workoutErrors({ ...workout, instructions: Array(101).fill("Instruction") }, true)).toContain("Keep workout instructions to 100 lines or fewer.");
  expect(workoutErrors({ ...workout, notes: Array(101).fill("Private note") }, true)).toContain("Keep private notes to 100 lines or fewer.");
  expect(workoutErrors({ ...workout, notes: ["x".repeat(2001)] }, true)).toEqual([]);
  const editing = editedContent({ ...workout, instructions: ["  Repeat  ", "", "  "], notes: ["  Rest after each round  ", "", "  "] });
  expect(editing.instructions).toEqual(["  Repeat  ", "", "  "]);
  expect(authoredWorkout(editing).instructions).toEqual(["Repeat"]);
  expect(editing.notes).toEqual(["  Rest after each round  ", "", "  "]);
  expect(authoredWorkout(editing).notes).toEqual(["Rest after each round"]);
  expect(authoredWorkout(editedContent({ ...workout, notes: [""] })).notes).toEqual([]);
});

it("validates all editable rich limits before persisting a command", () => {
  const block = { id: "main", label: "Main", grouping: "sequential" as const, exercises: [{ name: "Press" }] };
  const workout = { title: "My session", kind: "session" as const, provenance: "user" as const, blocks: [block] };
  for (const fields of [{ name: "x".repeat(201) }, { tempo: "x".repeat(101) },
    { effort: "x".repeat(501) }, { notes: "x".repeat(2001) }, { instructions: "x".repeat(2001) },
    { load: 2001, load_unit: "kg" as const, load_convention: "total" as const }]) {
    expect(workoutErrors({ ...workout, blocks: [{ ...block, exercises: [{ name: "Press", ...fields }] }] }).length).toBeGreaterThan(0);
  }
  expect(workoutErrors({ ...workout, blocks: [{ ...block, label: "x".repeat(201) }] }).length).toBeGreaterThan(0);
  expect(workoutErrors({ ...workout, blocks: Array.from({ length: 101 }, (_, i) => ({ ...block, id: String(i) })) }).length).toBeGreaterThan(0);
  expect(workoutErrors({ ...workout, blocks: [{ ...block, exercises: Array(101).fill({ name: "Press" }) }] }).length).toBeGreaterThan(0);
  expect(workoutErrors({ ...workout, equipment_required: Array(101).fill("Kettlebell") }).length).toBeGreaterThan(0);
  expect(workoutErrors({ ...workout, notes: ["x".repeat(4001)] })).toContain("Keep each private note within 4000 characters.");
  expect(workoutErrors({ ...workout, instructions: ["x".repeat(4001)] })).toContain("Keep each workout instruction within 4000 characters.");
  expect(workoutErrors({ ...workout, instructions: Array(90).fill("界".repeat(2000)) })).toContain(
    "This workout is too large to save. Shorten its instructions or split it into smaller workouts.");
  expect(workoutErrors({ ...workout, notes: Array(90).fill("界".repeat(2000)) })).toContain(
    "This workout is too large to save. Shorten its instructions or split it into smaller workouts.");
  expect(workoutErrors({ ...workout, blocks: [{ ...block, exercises: [{ name: "Press", instructions: "x".repeat(2000), notes: "x".repeat(2000),
    tempo: "x".repeat(100), effort: "x".repeat(500), load: 2000, load_unit: "kg", load_convention: "total" }] }] })).toEqual([]);
});
it("loads only the explicit public sharing route without private authorization", async () => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const read = publicShareReader("https://api.example.test", async (url, options) => {
    calls.push([String(url), options]);
    return new Response(JSON.stringify({ id: "public-snapshot" }));
  });
  await expect(read("invalid")).rejects.toThrow("invalid");
  expect(calls).toHaveLength(0);
  const token = "a".repeat(43);
  await read(token);
  expect(calls[0][0]).toBe(`https://api.example.test/api/v1/workouts/shared/${token}`);
  expect(calls[0][1]?.headers).toBeUndefined();
});

it.each(["image", "document"] as const)(
  "a delayed %s picker after original-owner erasure creates no owned copy and cleans only its SDK output",
  async (kind) => {
    const raw = new Map<string, string>();
    const registry = createPrivateStorageRegistry({
      getItem: async (k) => raw.get(k) ?? null,
      setItem: async (k, v) => {
        raw.set(k, v);
      },
      removeItem: async (k) => {
        raw.delete(k);
      },
      getAllKeys: async () => [...raw.keys()]
    });
    const owner = registry.capture("A");
    const guard = () => {
      if (!owner.isCurrent()) throw Error("retired");
    };
    const held = deferred<any>();
    (kind === "image" ? native.picker : native.document).mockReturnValue(held.promise);
    const pending = kind === "image" ? pickImages(false, guard, "A") : pickDocument(guard, "A");
    while (!(kind === "image" ? native.picker : native.document).mock.calls.length)
      await new Promise((done) => setTimeout(done, 0));
    await registry.erase("A");
    const uri = `file:///cache/${kind === "image" ? "ImagePicker" : "DocumentPicker"}/old-source.${kind === "image" ? "jpg" : "pdf"}`;
    const original = "file:///user-library/original",
      other = "file:///cache/hafa-workouts-capture/B-existing.jpg";
    native.files.set(uri, "private old source");
    native.files.set(original, "user original");
    native.files.set(other, "B source");
    held.resolve({ canceled: false, assets: [{ uri, name: "source", mimeType: "application/pdf", size: 100 }] });
    await expect(pending).rejects.toThrow("retired");
    expect(native.copy).not.toHaveBeenCalled();
    expect(native.manipulate).not.toHaveBeenCalled();
    expect([...native.files.keys()]).toEqual([original, other]);
  }
);

it("generation retirement during native copy removes the exact late destination and preserves originals/other owners", async () => {
  const held = deferred<void>();
  const entered = deferred<void>();
  let generation = 1;
  const original = "file:///shared/user-original.jpg",
    other = "file:///cache/hafa-workouts-capture/B.jpg";
  native.files.set(original, "original");
  native.files.set(other, "B source");
  native.copy.mockImplementation(async ({ to }: { to: string }) => {
    entered.resolve();
    await held.promise;
    native.files.set(to, "late private copy");
  });
  const pending = normalizeImages(
    [{ uri: original }],
    () => {
      if (generation !== 1) throw Error("generation changed");
    },
    "A"
  );
  await entered.promise;
  generation = 2;
  held.resolve();
  await expect(pending).rejects.toThrow("generation changed");
  expect([...native.files.keys()]).toEqual([original, other]);
});

it("retirement during normalization cleans the returned manipulator output without copying or deleting the supplied share original", async () => {
  const held = deferred<any>();
  let mounted = true;
  const original = "file:///shared/original.jpg";
  native.files.set(original, "original");
  native.manipulate.mockReturnValue(held.promise);
  const pending = normalizeImages(
    [{ uri: original }],
    () => {
      if (!mounted) throw Error("screen changed");
    },
    "A"
  );
  while (!native.manipulate.mock.calls.length) await new Promise((done) => setTimeout(done, 0));
  mounted = false;
  const uri = "file:///cache/ImageManipulator/late.jpg";
  native.files.set(uri, "private");
  held.resolve({ uri, base64: "AAAA", width: 900, height: 900 });
  await expect(pending).rejects.toThrow("screen changed");
  expect(native.copy).not.toHaveBeenCalled();
  expect([...native.files.keys()]).toEqual([original]);
});

it("the final 300–350KiB normalization candidate survives until copied, then all exact intermediate outputs clear", async () => {
  native.manipulate.mockImplementation(async () => {
    const uri = `file:///cache/ImageManipulator/${++native.next}.jpg`;
    native.files.set(uri, "normalized");
    return { uri, base64: "A".repeat(Math.ceil((320 * 1024) / 0.75)), width: 900, height: 900 };
  });
  const files = await normalizeImages([{ uri: "file:///user/original.jpg" }], () => {}, "A");
  expect(native.manipulate).toHaveBeenCalledTimes(3);
  expect([...native.files.keys()]).toEqual([files[0].uri]);
  expect(files[0].uri).toMatch(/hafa-workouts-capture/);
});

it.each(["normalization", "picker", "document"] as const)(
  "%s cleanup failure never loses successfully created capture files",
  async (where) => {
    const image = "file:///cache/ImagePicker/input.jpg",
      document = "file:///cache/DocumentPicker/input.pdf";
    native.files.set(image, "image");
    native.files.set(document, "document");
    native.picker.mockResolvedValue({ canceled: false, assets: [{ uri: image }] });
    native.document.mockResolvedValue({
      canceled: false,
      assets: [{ uri: document, name: "source", mimeType: "application/pdf", size: 100 }]
    });
    let rejected = false;
    native.remove.mockImplementation(async (uri: string) => {
      const chosen =
        where === "normalization" ? uri.includes("ImageManipulator/") : uri === (where === "picker" ? image : document);
      if (chosen && !rejected) {
        rejected = true;
        throw Error("cleanup unavailable");
      }
      native.files.delete(uri);
    });
    await expect(where === "document" ? pickDocument(() => {}, "A") : pickImages(false, () => {}, "A")).rejects.toThrow(
      "cleanup unavailable"
    );
    expect([...native.files.keys()].filter((x) => x.includes("hafa-workouts-capture/"))).toEqual([]);
  }
);

it("source reading stops after scope changes before a body can be passed to transport", async () => {
  const held = deferred<string>();
  let current = true;
  native.read.mockReturnValue(held.promise);
  const pending = sourceFor(
    {
      ...draft,
      kind: "images",
      files: [{ uri: "file:///cache/hafa-workouts-capture/A.jpg", mime_type: "image/jpeg", name: "A", owned: true }]
    },
    () => {
      if (!current) throw Error("retired");
    }
  );
  current = false;
  held.resolve("private bytes");
  await expect(pending).rejects.toThrow("retired");
});

it.each(["image", "document"] as const)(
  "a late %s copy with a failed destination delete remains journaled after completed product erasure and clears on restart",
  async (kind) => {
    const sdk = `file:///cache/${kind === "image" ? "ImagePicker" : "DocumentPicker"}/this-operation`;
    const original = "file:///user/original.jpg",
      other = "file:///cache/hafa-workouts-capture/other-account.jpg";
    native.files.set(sdk, "PRIVATE_BYTES");
    native.files.set(original, "User original");
    native.files.set(other, "Other account");
    native.records.set(draftKey("B", "capture:2"), JSON.stringify({ files: [{ uri: other, owned: true }] }));
    const registry = createPrivateStorageRegistry(journalStorage()),
      owner = registry.capture("A");
    const guard = () => {
      if (!owner.isCurrent()) throw Error("retired");
    };
    native.picker.mockResolvedValue({ canceled: false, assets: [{ uri: sdk }] });
    native.document.mockResolvedValue({
      canceled: false,
      assets: [{ uri: sdk, name: "source", mimeType: "application/pdf", size: 100 }]
    });
    let destination = "",
      failed = false;
    native.copy.mockImplementation(async ({ to }: { to: string }) => {
      // Assert the causal boundary, not only final cleanup state.
      expect(
        [...native.records.values()].some((raw) =>
          JSON.parse(raw).assets?.some((asset: { uri: string }) => asset.uri === to)
        )
      ).toBe(true);
      destination = to;
      native.files.set(to, "PRIVATE_BYTES");
      await registry.erase("A");
    });
    native.remove.mockImplementation(async (uri: string) => {
      if (uri === destination && !failed) {
        failed = true;
        throw Error("one-time destination delete failure");
      }
      native.files.delete(uri);
    });
    await expect(kind === "image" ? pickImages(false, guard, "A") : pickDocument(guard, "A")).rejects.toThrow(
      "one-time destination delete failure"
    );
    expect(native.files.has(destination)).toBe(true);
    expect([...native.records.keys()].filter((key) => key.startsWith("hafa-workouts:v1:A:"))).toEqual([]);
    const pending = [...native.records.entries()].filter(([key]) =>
      key.startsWith("hafa-workouts:capture-cleanup:v1:A:")
    );
    expect(pending).toHaveLength(1);
    expect(pending[0][1]).toContain(destination);
    expect(pending[0][1]).not.toContain("PRIVATE_BYTES");
    await restartedJournal().recover("A");
    expect([...native.files.keys()]).toEqual([original, other]);
    expect(native.records.has(pending[0][0])).toBe(false);
    expect(native.records.has(draftKey("B", "capture:2"))).toBe(true);
  }
);

it("restart reconciliation preserves an active registered source even when clearing its journal fails", async () => {
  const sdk = "file:///cache/ImagePicker/registered.jpg";
  native.files.set(sdk, "source");
  native.picker.mockResolvedValue({ canceled: false, assets: [{ uri: sdk }] });
  const files = await pickImages(false, () => {}, "A");
  native.records.set(draftKey("A", "capture:1"), JSON.stringify({ generation: 1, files }));
  let failed = false;
  native.recordRemove.mockImplementation(async (key: string) => {
    if (key.startsWith("hafa-workouts:capture-cleanup:") && !failed) {
      failed = true;
      throw Error("journal completion unavailable");
    }
    native.records.delete(key);
  });
  await expect(restartedJournal().recover("A")).rejects.toThrow("journal completion unavailable");
  expect(native.files.has(files[0].uri)).toBe(true);
  await restartedJournal().recover("A");
  expect(native.files.has(files[0].uri)).toBe(true);
  expect([...native.records.keys()].some((key) => key.startsWith("hafa-workouts:capture-cleanup:"))).toBe(false);
});

it("a failed destination journal write prevents the native copy and cleans exact returned SDK files", async () => {
  const sdk = "file:///cache/ImagePicker/journal-fail.jpg",
    original = "file:///user/original.jpg";
  native.files.set(sdk, "source");
  native.files.set(original, "User original");
  native.picker.mockResolvedValue({ canceled: false, assets: [{ uri: sdk }] });
  native.recordSet.mockImplementation(async (key: string, value: string) => {
    if (JSON.parse(value).assets?.some((asset: { kind: string }) => asset.kind === "capture"))
      throw Error("destination journal unavailable");
    native.records.set(key, value);
  });
  await expect(pickImages(false, () => {}, "A")).rejects.toThrow("destination journal unavailable");
  expect(native.copy).not.toHaveBeenCalled();
  expect([...native.files.keys()]).toEqual([original]);
});

it.each([
  "file:///user/original.jpg",
  "file:///cache/hafa-workouts-capture/",
  "file:///cache/hafa-workouts-capture/../other.jpg",
  "file:///cache/hafa-workouts-capture/%2e%2e/other.jpg"
])("cleanup ownership refuses unknown or unsafe location %s without a directory sweep", async (uri) => {
  const journal = restartedJournal(),
    lease = await journal.begin("A", "unsafe-operation");
  await expect(lease.remember([{ uri, kind: "capture" }])).rejects.toThrow("location");
  expect(native.remove).not.toHaveBeenCalled();
  await lease.finish();
  const key = "hafa-workouts:capture-cleanup:v1:A:unsafe-operation";
  native.records.set(
    key,
    JSON.stringify({
      version: 1,
      owner: "A",
      operation: "unsafe-operation",
      assets: [{ uri, kind: "capture" }],
      nativeProcessIdentity: native.nativeProcess,
      state: "settled",
      nativeKind: null,
      opaqueIncomplete: false
    })
  );
  await expect(restartedJournal().recover("A")).rejects.toThrow("cleanup metadata");
  expect(native.remove).not.toHaveBeenCalled();
  expect(native.records.has(key)).toBe(true);
});

it("actual product journal recovery during a held native copy keeps the marker until the late writer settles", async () => {
  const entered = deferred<void>(),
    held = deferred<void>();
  let current = true,
    destination = "",
    failed = false;
  const original = "file:///user/original.jpg",
    other = "file:///cache/hafa-workouts-capture/B.jpg";
  native.files.set(original, "User original");
  native.files.set(other, "Other account");
  native.copy.mockImplementation(async ({ to }: { to: string }) => {
    destination = to;
    entered.resolve();
    await held.promise;
    native.files.set(to, "Late private bytes");
  });
  native.remove.mockImplementation(async (uri: string) => {
    if (uri === destination && !failed) {
      failed = true;
      throw Error("one-time late delete failure");
    }
    native.files.delete(uri);
  });
  const pending = normalizeImages(
    [{ uri: original }],
    () => {
      if (!current) throw Error("retired");
    },
    "A"
  );
  await entered.promise;
  current = false;
  await expect(recoverCaptureCleanup("A")).rejects.toThrow("still finishing");
  const marker = [...native.records.values()].map((raw) => JSON.parse(raw))[0];
  expect(marker).toMatchObject({ state: "open", nativeKind: "known", nativeProcessIdentity: native.nativeProcess });
  expect(marker.assets.some((asset: { uri: string }) => asset.uri === destination)).toBe(true);
  expect(native.remove).not.toHaveBeenCalled();
  await expect(restartedJournal().recover("A")).rejects.toThrow("still finishing");
  held.resolve();
  await expect(pending).rejects.toThrow("one-time late delete failure");
  expect(native.files.has(destination)).toBe(true);
  await restartedJournal().recover("A");
  expect([...native.files.keys()]).toEqual([original, other]);
  expect(native.records.size).toBe(0);
});

it("known-path cold recovery requires a changed native process identity, not missing JS liveness", async () => {
  const key = "hafa-workouts:capture-cleanup:v1:A:old-known-writer",
    uri = "file:///cache/hafa-workouts-capture/old-known.jpg";
  native.files.set(uri, "Old partial bytes");
  native.records.set(
    key,
    JSON.stringify({
      version: 1,
      owner: "A",
      operation: "old-known-writer",
      assets: [{ uri, kind: "capture" }],
      nativeProcessIdentity: native.nativeProcess,
      state: "open",
      nativeKind: "known",
      opaqueIncomplete: false
    })
  );
  await expect(restartedJournal().recover("A")).rejects.toThrow("still finishing");
  expect(native.files.has(uri)).toBe(true);
  expect(native.records.has(key)).toBe(true);
  // This stands for an actual terminated/restarted native process; no old worker
  // can execute afterward. Merely rebuilding the JS factory above was insufficient.
  native.nativeProcess = "native-process-two";
  await restartedJournal().recover("A");
  expect(native.files.has(uri)).toBe(false);
  expect(native.records.has(key)).toBe(false);
});

it("an empty SDK-await marker is retained across same-process recovery and a cold process with unknown returned URIs", async () => {
  const held = deferred<any>();
  native.picker.mockReturnValueOnce(held.promise);
  const pending = pickImages(false, () => {}, "A");
  while (!native.picker.mock.calls.length) await new Promise((done) => setTimeout(done, 0));
  await expect(recoverCaptureCleanup("A")).rejects.toThrow("still finishing");
  const [key, raw] = [...native.records.entries()][0];
  expect(JSON.parse(raw)).toMatchObject({ assets: [], state: "open", nativeKind: "opaque" });
  native.nativeProcess = "native-process-two";
  await expect(restartedJournal().recover("A")).rejects.toThrow("did not return its file locations");
  expect(native.records.has(key)).toBe(true);
  expect(native.remove).not.toHaveBeenCalled();
  // Finish the original fake worker only to avoid leaving a test promise. No real
  // old worker survives the terminated-process condition modeled above.
  held.resolve({ canceled: true });
  await expect(pending).rejects.toThrow("stopped");
});

it("recovery cannot silently discard an empty open lease before its source action finishes", async () => {
  const journal = restartedJournal(),
    lease = await journal.begin("A", "empty-open-action");
  await expect(journal.recover("A")).rejects.toThrow("still finishing");
  expect(native.records.has("hafa-workouts:capture-cleanup:v1:A:empty-open-action")).toBe(true);
  await lease.finish();
  await lease.cleanup();
  expect(native.records.size).toBe(0);
});

it("scope retirement before SDK dispatch closes the lease without inventing an unknown SDK result", async () => {
  let current = true;
  native.recordSet.mockImplementation(async (key: string, raw: string) => {
    native.records.set(key, raw);
    if (JSON.parse(raw).nativeKind === "opaque") current = false;
  });
  await expect(
    pickImages(
      false,
      () => {
        if (!current) throw Error("retired before native dispatch");
      },
      "A"
    )
  ).rejects.toThrow("retired before native dispatch");
  expect(native.picker).not.toHaveBeenCalled();
  expect(native.records.size).toBe(0);
});

it("a missing native process identity is not proof that an unfinished known writer died", async () => {
  const key = "hafa-workouts:capture-cleanup:v1:A:unknown-process",
    uri = "file:///cache/hafa-workouts-capture/unknown-process.jpg";
  native.files.set(uri, "Private bytes");
  native.records.set(
    key,
    JSON.stringify({
      version: 1,
      owner: "A",
      operation: "unknown-process",
      assets: [{ uri, kind: "capture" }],
      nativeProcessIdentity: native.nativeProcess,
      state: "open",
      nativeKind: "known",
      opaqueIncomplete: false
    })
  );
  const unknown = createCaptureCleanupJournal(
    journalStorage(),
    () => "file:///cache/",
    (uri) => native.remove(uri),
    async () => ""
  );
  await expect(unknown.recover("A")).rejects.toThrow("updated installed app");
  expect(native.files.has(uri)).toBe(true);
  expect(native.records.has(key)).toBe(true);
  expect(native.remove).not.toHaveBeenCalled();
});
it("concurrent import completion and intake keep the newer reference", async () => {
  const { drafts } = await import("./drafts");
  const { updateImportReferences } = await import("./capture");
  const registry = createPrivateStorageRegistry(journalStorage());
  const local = drafts(registry.capture("reference-owner"));
  await local.save("reference-owner", "imports:1", [{ id: "A", label: "First" }]);
  await Promise.all([
    updateImportReferences(local, "reference-owner", 1, () => {}, (items) => items.filter((item) => item.id !== "A")),
    updateImportReferences(local, "reference-owner", 1, () => {}, (items) => [{ id: "B", label: "Newer" }, ...items]),
  ]);
  expect(await local.load("reference-owner", "imports:1")).toEqual([{ id: "B", label: "Newer" }]);
});

it("shared-link caption wrappers are removed while literal URL punctuation is preserved", async () => {
  const { sharedWorkoutURL } = await import("./capture");
  expect(sharedWorkoutURL(null, "Watch (https://youtu.be/qa-video)." )).toBe("https://youtu.be/qa-video");
  expect(sharedWorkoutURL(null, "Read [https://example.test/a_(b)]." )).toBe("https://example.test/a_(b)");
  expect(sharedWorkoutURL(null, "https://example.test/a." )).toBe("https://example.test/a.");
  expect(sharedWorkoutURL("https://example.test/a;", "Caption")).toBe("https://example.test/a;");
});


it("queued source archives survive startup cleanup and retire only their own completed job", async () => {
  const owner = "archive-owner", storage = journalStorage(), uuid = () => `archive-${++native.next}`;
  const slot = createPrivateDraftSlot<CaptureDraft>(storage, owner, "capture:1", uuid);
  const original = { uri: "file:///cache/hafa-workouts-capture/queued-A.pdf", mime_type: "application/pdf", name: "A", owned: true };
  native.files.set(original.uri, "A");
  const lease = await restartedJournal().begin(owner, "queued-operation");
  await lease.remember([{ uri: original.uri, kind: "capture" }]); await lease.finish();
  const first = await slot.save(null, { ...draft, generation: 1, request_id: "source-A", job_id: "job-A", is_public: false, files: [original] }, () => {});
  await archiveCapturedImport(storage, owner, 1, first, () => {}, uuid);
  expect((await slot.load(() => {})).value).toBeNull();
  await restartedJournal().recover(owner);
  expect(native.files.has(original.uri)).toBe(true);
  const second = await slot.save(null, { ...draft, generation: 1, request_id: "source-B", job_id: "job-B", is_public: true, files: [] }, () => {});
  await archiveCapturedImport(storage, owner, 1, second, () => {}, uuid);
  await slot.save(null, { ...draft, generation: 1, request_id: "newest", files: [] }, () => {});
  expect((await loadCapturedImport(storage, owner, 1, "job-A", () => {}, uuid)).value).toMatchObject({ request_id: "source-A", is_public: false, files: [original] });
  native.remove.mockRejectedValueOnce(Error("file unavailable"));
  await expect(retireCapturedImport(storage, owner, 1, "job-A", () => {}, cleanupCaptureFiles, uuid)).rejects.toThrow("file unavailable");
  expect(JSON.parse(native.records.get(draftKey(owner, submittedCaptureScope(1, "job-A")))!)).toMatchObject({ cleanup_files: [original] });
  await retireCapturedImport(storage, owner, 1, "job-A", () => {}, cleanupCaptureFiles, uuid);
  expect(native.records.has(draftKey(owner, submittedCaptureScope(1, "job-A")))).toBe(false);
  expect(native.files.has(original.uri)).toBe(false);
  expect((await loadCapturedImport(storage, owner, 1, "job-B", () => {}, uuid)).value?.request_id).toBe("source-B");
  expect((await slot.load(() => {})).value?.request_id).toBe("newest");
});

it("completed-job retirement waits for a held archive write instead of deleting files during transfer", async () => {
  const owner = "held-retirement-owner", storage = journalStorage(), uuid = () => `held-${++native.next}`;
  const slot = createPrivateDraftSlot<CaptureDraft>(storage, owner, "capture:1", uuid);
  const file = { uri: "file:///cache/hafa-workouts-capture/held.pdf", mime_type: "application/pdf", name: "Held", owned: true };
  native.files.set(file.uri, "Source");
  const prior = await slot.save(null, { ...draft, generation: 1, request_id: "held-source", job_id: "held-job", files: [file] }, () => {});
  const held = deferred<void>(), archiveKey = draftKey(owner, submittedCaptureScope(1, "held-job"));
  let started = false;
  native.recordSet.mockImplementation(async (key, value) => { if (key === archiveKey) { started = true; await held.promise; } native.records.set(key, value); });
  const archiving = archiveCapturedImport(storage, owner, 1, prior, () => {}, uuid);
  while (!started) await new Promise(resolve => setTimeout(resolve, 0));
  const retiring = retireCapturedImport(storage, owner, 1, "held-job", () => {}, cleanupCaptureFiles, uuid);
  expect(native.remove).not.toHaveBeenCalled();
  expect((await slot.load(() => {})).value?.request_id).toBe("held-source");
  held.resolve(); await archiving; await retiring;
  expect(native.files.has(file.uri)).toBe(false);
  expect(native.records.has(archiveKey)).toBe(false);
  expect((await slot.load(() => {})).value).toBeNull();
});

it("source review waits for a held archive transaction before reading either source slot", async () => {
  const owner = "consistent-read-owner", storage = journalStorage(), uuid = () => `read-${++native.next}`;
  const slot = createPrivateDraftSlot<CaptureDraft>(storage, owner, "capture:1", uuid);
  const source = { ...draft, generation: 1, request_id: "read-source", job_id: "read-job", is_public: false };
  const prior = await slot.save(null, source, () => {});
  const held = deferred<void>(), referencesKey = draftKey(owner, "imports:1");
  let publishingReferences = false;
  native.recordSet.mockImplementation(async (key, value) => {
    if (key === referencesKey) { publishingReferences = true; await held.promise; }
    native.records.set(key, value);
  });
  const archiving = archiveCapturedImport(storage, owner, 1, prior, () => {}, uuid);
  while (!publishingReferences) await new Promise(resolve => setTimeout(resolve, 0));
  // The archive has committed, but the composer still owns the original until references finish.
  expect(native.records.has(draftKey(owner, submittedCaptureScope(1, "read-job")))).toBe(true);
  expect((await slot.load(() => {})).value?.request_id).toBe("read-source");
  let reviewed = false;
  const reading = loadCapturedImport(storage, owner, 1, "read-job", () => {}, uuid).then(value => { reviewed = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 0));
  const readDuringHandoff = reviewed;
  held.resolve(); await archiving;
  expect((await reading).value).toMatchObject(source);
  expect((await slot.load(() => {})).value).toBeNull();
  expect(readDuringHandoff).toBe(false);
});

const iosContainerParent = "file:///var/mobile/Containers/Data/Application/";
const oldCache = `${iosContainerParent}11111111-1111-4111-8111-111111111111/Library/Caches/`;
const newCache = `${iosContainerParent}22222222-2222-4222-8222-222222222222/Library/Caches/`;
const relocationKey = "hafa-workouts:capture-cleanup:v1:A:relocated-operation";
const relocatedJournal = (root = newCache) => createCaptureCleanupJournal(
  journalStorage(), () => root, uri => native.remove(uri), async () => native.nativeProcess);
function relocationRecord(uri: string, kind = "capture", extra: Record<string, unknown> = {}) {
  const record = { version: 1, owner: "A", operation: "relocated-operation", assets: [{ uri, kind }],
    nativeProcessIdentity: "old-native-process", state: "settled", nativeKind: null, opaqueIncomplete: false, ...extra };
  native.records.set(relocationKey, JSON.stringify(record));
  return record;
}

it.each(["hafa-workouts-capture/", "ImagePicker/", "DocumentPicker/", "ImageManipulator/"])("recovers a settled relocated iOS cache asset only under the current root (%s)", async directory => {
  const kinds: Record<string, string> = { "hafa-workouts-capture/": "capture", "ImagePicker/": "picker", "DocumentPicker/": "document", "ImageManipulator/": "manipulator" };
  const kind = kinds[directory];
  const old = `${oldCache}${directory}owned.jpg`, current = `${newCache}${directory}owned.jpg`;
  relocationRecord(old, kind); native.files.set(current, "Relocated owned bytes");
  native.files.set(old, "Never touch the retired container");
  await relocatedJournal().recover("A");
  expect(native.remove).toHaveBeenCalledWith(current); expect(native.remove).not.toHaveBeenCalledWith(old);
  expect(native.files.get(old)).toBe("Never touch the retired container");
  expect(native.files.has(current)).toBe(false); expect(native.records.has(relocationKey)).toBe(false);
});

it("settled relocation cleans an already missing current asset idempotently", async () => {
  relocationRecord(`${oldCache}hafa-workouts-capture/gone.jpg`);
  await relocatedJournal().recover("A");
  expect(native.remove).toHaveBeenCalledWith(`${newCache}hafa-workouts-capture/gone.jpg`);
  expect(native.records.has(relocationKey)).toBe(false);
});

it.each([
  ["capture", "hafa-workouts-capture/"], ["picker", "ImagePicker/"],
  ["document", "DocumentPicker/"], ["manipulator", "ImageManipulator/"],
].flatMap(([kind, directory]) => [false, true].map(relocated => ({ kind, directory, relocated }))))(
  "protects registered owned $kind assets (relocated=$relocated) and cleans debt after unregister", async ({ kind, directory, relocated }) => {
    const root = relocated ? newCache : "file:///cache/";
    const originalUri = `${relocated ? oldCache : root}${directory}registered.jpg`, current = `${root}${directory}registered.jpg`;
    relocationRecord(originalUri, kind); native.files.set(current, "Registered source bytes");
    const key = draftKey("A", "capture:1"), draft = JSON.stringify({ files: [{ owned: true, uri: originalUri }] });
    native.records.set(key, draft);
    const journal = relocatedJournal(root);
    await journal.recover("A");
    expect(native.remove).not.toHaveBeenCalled(); expect(native.files.get(current)).toBe("Registered source bytes");
    expect(native.records.get(key)).toBe(draft);
    if (kind === "capture" && !relocated) {
      // Current capture files retain the existing transfer to draft-owned cleanup.
      expect(native.records.has(relocationKey)).toBe(false);
    } else {
      expect(JSON.parse(native.records.get(relocationKey)!)).toMatchObject({ state: "settled", assets: [{ kind, uri: current }] });
    }
    native.records.delete(key);
    // Normal draft cleanup handles current captures; startup/account erasure also
    // recovers journals after unregister, including SDK and relocated capture debt.
    await cleanupCaptureFiles([{ uri: originalUri, name: "registered.jpg", mime_type: "image/jpeg", owned: true }], true);
    await journal.recover("A");
    expect(native.files.has(current)).toBe(false); expect(native.records.has(relocationKey)).toBe(false);
    expect(native.remove).not.toHaveBeenCalledWith(relocated ? originalUri : "file:///outside-cache.jpg");
  }
);

it("persists only the rebased asset before deletion and retains it for a failed-delete retry", async () => {
  const old = `${oldCache}hafa-workouts-capture/retry.jpg`, current = `${newCache}hafa-workouts-capture/retry.jpg`;
  const original = relocationRecord(old); native.files.set(current, "Retry bytes");
  native.remove.mockImplementationOnce(async () => {
    expect(JSON.parse(native.records.get(relocationKey)!)).toMatchObject({ ...original, assets: [{ uri: current, kind: "capture" }] });
    throw Error("temporary delete failure");
  });
  await expect(relocatedJournal().recover("A")).rejects.toThrow("temporary delete failure");
  expect(JSON.parse(native.records.get(relocationKey)!).assets).toEqual([{ uri: current, kind: "capture" }]);
  await relocatedJournal().recover("A");
  expect(native.records.has(relocationKey)).toBe(false); expect(native.remove).not.toHaveBeenCalledWith(old);
});

it.each([
  `${oldCache}hafa-workouts-capture/../escape.jpg`,
  `${oldCache}hafa-workouts-capture/%2e%2e/escape.jpg`,
  `${oldCache}hafa-workouts-capture/%252e%252e/escape.jpg`,
  `${oldCache}hafa-workouts-capture/%2fescape.jpg`,
  `${oldCache}hafa-workouts-capture/owned.jpg?query`,
  `${oldCache}hafa-workouts-capture/owned.jpg#fragment`,
  `${oldCache}hafa-workouts-capture/nested\\escape.jpg`,
  `${oldCache}ImagePicker/owned.jpg`,
  `${oldCache}unknown/owned.jpg`,
  "file:///arbitrary/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Library/Caches/hafa-workouts-capture/owned.jpg",
  "file://foreign/var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Library/Caches/hafa-workouts-capture/owned.jpg",
])("rejects unsafe or mismatched legacy cache paths without deleting or rewriting (%s)", async uri => {
  const original = relocationRecord(uri), raw = JSON.stringify(original);
  await expect(relocatedJournal().recover("A")).rejects.toThrow("metadata needs review");
  expect(native.remove).not.toHaveBeenCalled(); expect(native.records.get(relocationKey)).toBe(raw);
});

it("does not rebase a different simulator device or a non-iOS cache root", async () => {
  const parent = "file:///Users/qa/Library/Developer/CoreSimulator/Devices/33333333-3333-4333-8333-333333333333/data/Containers/Data/Application/";
  const root = `${parent}22222222-2222-4222-8222-222222222222/Library/Caches/`;
  relocationRecord(`${parent.replace("33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444")}11111111-1111-4111-8111-111111111111/Library/Caches/hafa-workouts-capture/owned.jpg`);
  await expect(relocatedJournal(root).recover("A")).rejects.toThrow("metadata needs review");
  relocationRecord(`${oldCache}hafa-workouts-capture/owned.jpg`);
  await expect(relocatedJournal("file:///cache/").recover("A")).rejects.toThrow("metadata needs review");
  expect(native.remove).not.toHaveBeenCalled();
});

it("does not use relocation to bypass same-process native writes or an opaque old operation", async () => {
  const uri = `${oldCache}hafa-workouts-capture/active.jpg`;
  relocationRecord(uri, "capture", { state: "open", nativeKind: "known", nativeProcessIdentity: native.nativeProcess });
  const sameProcess = native.records.get(relocationKey);
  await expect(relocatedJournal().recover("A")).rejects.toThrow("still finishing");
  expect(native.records.get(relocationKey)).toBe(sameProcess);
  relocationRecord(uri, "capture", { state: "open", nativeKind: "opaque" });
  const opaque = native.records.get(relocationKey);
  await expect(relocatedJournal().recover("A")).rejects.toThrow("did not return its file locations");
  expect(native.records.get(relocationKey)).toBe(opaque); expect(native.remove).not.toHaveBeenCalled();
});

it("permits relocated known-writer recovery only after its native process changed", async () => {
  const old = `${oldCache}hafa-workouts-capture/cold-known.jpg`;
  relocationRecord(old, "capture", { state: "open", nativeKind: "known" });
  await relocatedJournal().recover("A");
  expect(native.remove).toHaveBeenCalledWith(`${newCache}hafa-workouts-capture/cold-known.jpg`);
  expect(native.records.has(relocationKey)).toBe(false);
});

it("keeps new capture admission current-root only and preserves opaque-incomplete recovery", async () => {
  const journal = relocatedJournal(), lease = await journal.begin("A", "new-operation");
  await expect(lease.remember([{ uri: `${oldCache}hafa-workouts-capture/old.jpg`, kind: "capture" }])).rejects.toThrow("cannot be owned");
  await lease.finish(); await lease.cleanup();
  relocationRecord(`${oldCache}hafa-workouts-capture/opaque.jpg`, "capture", { opaqueIncomplete: true });
  await expect(journal.recover("A")).rejects.toThrow("ended without confirming its files");
  expect(JSON.parse(native.records.get(relocationKey)!)).toMatchObject({ opaqueIncomplete: true, assets: [] });
});

it("rebases the same Simulator device container while retaining owner and operation checks", async () => {
  const parent = "file:///Users/qa/Library/Developer/CoreSimulator/Devices/33333333-3333-4333-8333-333333333333/data/Containers/Data/Application/";
  const root = `${parent}22222222-2222-4222-8222-222222222222/Library/Caches/`;
  const old = `${parent}11111111-1111-4111-8111-111111111111/Library/Caches/hafa-workouts-capture/owned.jpg`;
  relocationRecord(old, "capture", { owner: "B" });
  await expect(relocatedJournal(root).recover("A")).rejects.toThrow("metadata needs review");
  expect(native.remove).not.toHaveBeenCalled();
  relocationRecord(old, "capture", { operation: "other-operation" });
  await expect(relocatedJournal(root).recover("A")).rejects.toThrow("metadata needs review");
  expect(native.remove).not.toHaveBeenCalled();
  relocationRecord(old);
  await relocatedJournal(root).recover("A");
  expect(native.remove).toHaveBeenCalledWith(`${root}hafa-workouts-capture/owned.jpg`);
  expect(native.remove).not.toHaveBeenCalledWith(old);
});
