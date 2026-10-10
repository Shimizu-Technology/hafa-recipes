import { beforeEach, it, expect, vi } from "vitest";
import { captureErrors, boundedSource, importIsTerminal, type CaptureDraft } from "./capture";
import { filterLibrary, workoutErrors, editedContent } from "./library";
import { isISODate, publicShareReader } from "./sharing";
const native = vi.hoisted(() => ({
  files: new Map<string, string>(),
  records: new Map<string, string>(),
  nativeProcess: "native-process-one",
  recordSet: vi.fn(),
  recordRemove: vi.fn(),
  next: 0,
  picker: vi.fn(),
  document: vi.fn(),
  manipulate: vi.fn(),
  copy: vi.fn(),
  remove: vi.fn(),
  read: vi.fn()
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
  requireOptionalNativeModule: () => ({ nativeProcessIdentity: () => native.nativeProcess })
}));
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
  getInfoAsync: async (uri: string) => ({ exists: native.files.has(uri), isDirectory: false, size: 100 }),
  EncodingType: { Base64: "base64" }
}));
import { normalizeImages, pickImages, pickDocument, sourceFor, recoverCaptureCleanup } from "./capture-io";
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
  native.files.clear();
  native.records.clear();
  native.next = 0;
  vi.clearAllMocks();
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
