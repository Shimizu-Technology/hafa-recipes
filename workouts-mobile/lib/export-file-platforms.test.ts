import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DocumentResult, DocumentSaver } from "./save-document";
const f = vi.hoisted(() => ({ sources: new Map<string, string>(), deletes: vi.fn(), sharing: vi.fn(), available: vi.fn(), module: null as DocumentSaver | null,
  choose: vi.fn(), copy: vi.fn(), discard: vi.fn(), cancel: vi.fn(), next: 0 }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `00000000-0000-0000-0000-${String(++f.next).padStart(12, "0")}` }));
vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => f.module }));
vi.mock("expo-sharing", () => ({ isAvailableAsync: f.available, shareAsync: f.sharing }));
vi.mock("expo-file-system", () => {
  class Directory {
    uri: string;
    constructor(...parts: Array<string | Directory>) { this.uri = parts.map((p) => typeof p === "string" ? p : p.uri).join("/"); }
    create() {}
    get exists() { return [...f.sources.keys()].some((key) => key.startsWith(this.uri)); }
    delete() { for (const key of f.sources.keys()) if (key.startsWith(this.uri)) f.sources.delete(key); }
  }
  class File {
    uri: string;
    constructor(folder: Directory, name: string) { this.uri = `${folder.uri}/${name}`; }
    get exists() { return f.sources.has(this.uri); }
    create() { f.sources.set(this.uri, ""); }
    write(value: string) { f.sources.set(this.uri, value); }
    delete() { f.deletes(this.uri); f.sources.delete(this.uri); }
  }
  return { Directory, File, Paths: { cache: "file://owned-cache" } };
});
import { savePrivateExport as android } from "./export-file.android";
import { savePrivateExport as ios } from "./export-file.native";

beforeEach(() => {
  vi.clearAllMocks(); f.sources.clear(); f.next = 0;
  f.deletes.mockReset();
  f.choose.mockResolvedValue({ status: "selected" }); f.copy.mockResolvedValue({ status: "saved" });
  f.discard.mockResolvedValue({ status: "cancelled" }); f.available.mockResolvedValue(true); f.sharing.mockResolvedValue(undefined);
  f.module = { chooseDestination: f.choose, copyToDestination: f.copy, discardDestination: f.discard, cancel: f.cancel };
});
afterEach(() => { f.sources.clear(); });
it("keeps Android source until destination-close acknowledgement, then removes it without sharing", async () => {
  let close!: (result: DocumentResult) => void;
  f.copy.mockReturnValue(new Promise<DocumentResult>((done) => { close = done; }));
  const options = { revalidate: vi.fn(async () => {}) }; let finished = false;
  const work = android({ workouts: [{ id: "synthetic" }] }, "owned-account", () => {}, options)
    .then((result) => { finished = true; return result; });
  await vi.waitFor(() => expect(f.copy).toHaveBeenCalledOnce());
  expect(f.sources.size).toBe(1); expect(f.deletes).not.toHaveBeenCalled(); expect(finished).toBe(false);
  expect([...f.sources.values()][0]).toBe('{"workouts":[{"id":"synthetic"}]}');
  close({ status: "saved" }); expect(await work).toBe("saved");
  expect(f.sources.size).toBe(0); expect(f.deletes).toHaveBeenCalledOnce(); expect(f.sharing).not.toHaveBeenCalled();
});
it("Android picker cancellation and failed copy both remove the private source", async () => {
  f.choose.mockResolvedValueOnce({ status: "cancelled" });
  expect(await android({}, "owned-account", () => {}, { revalidate: async () => {} })).toBe("cancelled");
  expect(f.sources.size).toBe(0); expect(f.copy).not.toHaveBeenCalled();
  f.copy.mockResolvedValueOnce({ status: "failed", cleanupIncomplete: true });
  await expect(android({}, "owned-account", () => {}, { revalidate: async () => {} })).rejects.toThrow("incomplete file may remain");
  expect(f.sources.size).toBe(0); expect(f.sharing).not.toHaveBeenCalled();
});
it("missing Android ABI refuses saving before creating a source and never falls back to sharing", async () => {
  f.module = null;
  await expect(android({}, "owned-account", () => {}, { revalidate: async () => {} })).rejects.toThrow("Update the app");
  expect(f.sources.size).toBe(0); expect(f.choose).not.toHaveBeenCalled(); expect(f.sharing).not.toHaveBeenCalled();
});
it("iOS keeps truthful opened result and deletes only after its existing share completion", async () => {
  let close!: () => void;
  f.sharing.mockReturnValue(new Promise<void>((done) => { close = done; }));
  const options = { revalidate: vi.fn(async () => {}) };
  const work = ios({ workouts: [] }, "owned-account", () => {}, options);
  await vi.waitFor(() => expect(f.sharing).toHaveBeenCalledOnce()); expect(f.sources.size).toBe(1);
  expect(f.choose).not.toHaveBeenCalled(); expect(options.revalidate).not.toHaveBeenCalled();
  close(); expect(await work).toBe("opened"); expect(f.sources.size).toBe(0);
});
it("Android incomplete destination stays primary when private source cleanup also fails", async () => {
  f.copy.mockResolvedValue({ status: "failed", cleanupIncomplete: true });
  f.deletes.mockImplementation(() => { throw Error("private source path must not escape"); });
  const work = android({}, "owned-account", () => {}, { revalidate: async () => {} });
  await expect(work).rejects.toMatchObject({
    message: expect.stringMatching(/^Saving did not finish\. An incomplete file may remain/),
    localCleanupWarning: "The temporary private export could not be removed. Try local data cleanup before saving again.",
  });
  await expect(work).rejects.toThrow("local data cleanup");
  await expect(work).rejects.not.toThrow("private source path");
  expect(f.sources.size).toBe(1); expect(f.sharing).not.toHaveBeenCalled();
});
it("iOS primary save failure survives source cleanup failure without provider/path text", async () => {
  f.sharing.mockRejectedValue(Error("content://private/provider-error"));
  f.deletes.mockImplementation(() => { throw Error("file://private/source-error"); });
  const work = ios({}, "owned-account", () => {});
  await expect(work).rejects.toMatchObject({ message: expect.stringMatching(/^The save options could not be opened\./),
    localCleanupWarning: expect.stringContaining("local data cleanup") });
  await expect(work).rejects.not.toThrow("content://"); await expect(work).rejects.not.toThrow("file://");
  expect(f.sources.size).toBe(1); expect(f.choose).not.toHaveBeenCalled();
});
it("a successful Android write remains truthful when only source removal fails", async () => {
  f.deletes.mockImplementation(() => { throw Error("private source deletion failed"); });
  await expect(android({}, "owned-account", () => {}, { revalidate: async () => {} })).rejects
    .toThrow(/^Your private export was saved\. The temporary private export could not be removed\./);
});
it("iOS opened outcome never becomes a saved claim after source cleanup failure", async () => {
  f.deletes.mockImplementation(() => { throw Error("private source deletion failed"); });
  await expect(ios({}, "owned-account", () => {})).rejects.toThrow("cannot tell whether you saved a copy");
  expect(f.choose).not.toHaveBeenCalled();
});
