import { describe, expect, it, vi } from "vitest";
import { saveDocument, type DocumentResult, type DocumentSaver } from "./save-document";
import { exportSaveMessage, legacySaveRecovery, requireSameExportManifest } from "./export-save";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const saver = {
    chooseDestination: vi.fn<DocumentSaver["chooseDestination"]>(async () => ({ status: "selected" })),
    copyToDestination: vi.fn<DocumentSaver["copyToDestination"]>(async () => ({ status: "saved" })),
    discardDestination: vi.fn<DocumentSaver["discardDestination"]>(async () => ({ status: "cancelled" })),
    cancel: vi.fn<DocumentSaver["cancel"]>(),
  };
  let current = true;
  const guard = () => { if (!current) throw Error("This private export belongs to a retired account or enrollment."); };
  const options = { signal: new AbortController().signal, revalidate: vi.fn(async () => {}), onModal: vi.fn() };
  return { saver, guard, options, retire: () => { current = false; },
    run: () => saveDocument(saver, "owned-operation", "owned-source", "owned-scope", guard, options) };
}
describe("Android document save orchestration", () => {
  it("holds completion until native destination copy AND close acknowledgement; rechecks after selection", async () => {
    const s = setup(); const closed = deferred<DocumentResult>(); s.saver.copyToDestination.mockReturnValue(closed.promise);
    let finished = false; const work = s.run().then((v) => { finished = true; return v; });
    await vi.waitFor(() => expect(s.saver.copyToDestination).toHaveBeenCalledOnce());
    expect(finished).toBe(false); expect(s.options.revalidate).toHaveBeenCalledOnce();
    expect(s.options.revalidate.mock.invocationCallOrder[0]).toBeGreaterThan(s.saver.chooseDestination.mock.invocationCallOrder[0]);
    expect(s.options.revalidate.mock.invocationCallOrder[0]).toBeLessThan(s.saver.copyToDestination.mock.invocationCallOrder[0]);
    expect(s.options.onModal.mock.calls).toEqual([[true], [false]]);
    closed.resolve({ status: "saved" }); expect(await work).toBe("saved");
  });
  it("cancelled picker never copies, validates or invents a saved file", async () => {
    const s = setup(); s.saver.chooseDestination.mockResolvedValue({ status: "cancelled" });
    expect(await s.run()).toBe("cancelled"); expect(s.options.revalidate).not.toHaveBeenCalled();
    expect(s.saver.copyToDestination).not.toHaveBeenCalled(); expect(s.saver.discardDestination).not.toHaveBeenCalled();
  });
  it("captured scope loss during picker discards only its native owned destination", async () => {
    const s = setup(); const picker = deferred<DocumentResult>(); s.saver.chooseDestination.mockReturnValue(picker.promise);
    const work = s.run(); s.retire(); picker.resolve({ status: "selected" });
    await expect(work).rejects.toThrow("retired"); expect(s.saver.copyToDestination).not.toHaveBeenCalled();
    expect(s.saver.discardDestination).toHaveBeenCalledWith("owned-operation");
  });
  it("aborts a pending picker; its late selection is cleaned, never copied", async () => {
    const s = setup(); const abort = new AbortController(); s.options.signal = abort.signal;
    const picker = deferred<DocumentResult>(); s.saver.chooseDestination.mockReturnValue(picker.promise);
    const work = s.run(); abort.abort(); expect(s.saver.cancel).toHaveBeenCalledWith("owned-operation");
    picker.resolve({ status: "selected" }); await expect(work).rejects.toThrow("Saving was stopped");
    expect(s.saver.copyToDestination).not.toHaveBeenCalled(); expect(s.saver.discardDestination).toHaveBeenCalledOnce();
  });
  it("a privacy/expiry check failure prevents stale copying and preserves safe status", async () => {
    const s = setup(); s.options.revalidate.mockRejectedValue(Object.assign(Error("private provider URI"), { status: 410 }));
    await expect(s.run()).rejects.toMatchObject({ status: 410 }); expect(s.saver.copyToDestination).not.toHaveBeenCalled();
    expect(s.saver.discardDestination).toHaveBeenCalledOnce();
  });
  it("scope loss during revalidation prevents copying even when that read succeeds", async () => {
    const s = setup(); s.options.revalidate.mockImplementation(async () => { s.retire(); });
    await expect(s.run()).rejects.toThrow("retired"); expect(s.saver.copyToDestination).not.toHaveBeenCalled();
  });
  it("native copy failure never reports saved", async () => {
    const s = setup(); s.saver.copyToDestination.mockResolvedValue({ status: "failed" });
    await expect(s.run()).rejects.toThrow("could not be saved");
    expect(s.saver.discardDestination).not.toHaveBeenCalled(); // Native copy owns error cleanup.
  });
  it("reports an incomplete destination when provider cleanup cannot be acknowledged", async () => {
    const s = setup(); s.saver.copyToDestination.mockResolvedValue({ status: "failed", cleanupIncomplete: true });
    await expect(s.run()).rejects.toThrow("incomplete file may remain");
  });
  it("retains incomplete cleanup outcome when a stale selected target cannot be removed", async () => {
    const s = setup(); s.options.revalidate.mockRejectedValue(Error("offline"));
    s.saver.discardDestination.mockResolvedValue({ status: "cancelled", cleanupIncomplete: true });
    await expect(s.run()).rejects.toThrow("incomplete file may remain");
  });
  it("sanitizes an unexpected cleanup exception while retaining incomplete-file uncertainty", async () => {
    const s = setup(); s.options.revalidate.mockRejectedValue(Error("offline"));
    s.saver.discardDestination.mockRejectedValue(Error("content://private/target"));
    await expect(s.run()).rejects.toThrow("incomplete file may remain");
  });
  it("sanitizes unexpected native exceptions instead of leaking source path or URI", async () => {
    const s = setup(); s.saver.chooseDestination.mockRejectedValue(Error("content://private /private/source secret"));
    await expect(s.run()).rejects.toThrow(/^The export could not be saved\./);
  });
  it("rejects an already aborted operation before showing a picker", async () => {
    const s = setup(); const abort = new AbortController(); abort.abort(); s.options.signal = abort.signal;
    await expect(s.run()).rejects.toThrow("Saving was stopped"); expect(s.saver.chooseDestination).not.toHaveBeenCalled();
  });
});

describe("post-picker manifest and copy", () => {
  const manifest = { id: "snapshot", generation: 3, schema_version: 1 as const, created_at: "2026-10-10T00:00:00Z",
    expires_at: "2999-10-10T00:00:00Z", page_count: 2, page_size: 10 as const, totals: { workouts: 11, versions: 12 } };
  it("accepts the same snapshot with reordered total keys", () => {
    expect(() => requireSameExportManifest(manifest, { ...manifest, totals: { versions: 12, workouts: 11 } })).not.toThrow();
  });
  it.each([{ id: "another" }, { generation: 4 }, { page_count: 3 }, { expires_at: "2000-01-01T00:00:00Z" },
    { totals: { workouts: 10, versions: 12 } }])("rejects changed/expired manifest %j", (patch) => {
    expect(() => requireSameExportManifest(manifest, { ...manifest, ...patch })).toThrow("changed or expired");
  });
  it("uses simple Android saved/cancelled wording and preserves truthful iOS opened wording", () => {
    expect(exportSaveMessage("saved")).toContain("was saved");
    expect(exportSaveMessage("cancelled")).toContain("cancelled");
    expect(exportSaveMessage("opened")).toContain("cannot tell whether you saved");
  });
  it("retains the content-free legacy interrupted-save marker until an acknowledged result", async () => {
    const map = new Map<string, string>();
    const storage = { getItem: async (key: string) => map.get(key) ?? null,
      setItem: async (key: string, value: string) => { map.set(key, value); }, removeItem: async (key: string) => { map.delete(key); } };
    const first = legacySaveRecovery(storage, "owner", 3); await first.begin();
    expect([...map.values()]).toEqual(["pending"]);
    const restored = legacySaveRecovery(storage, "owner", 3); expect(await restored.pending()).toBe(true);
    expect(await legacySaveRecovery(storage, "owner", 4).pending()).toBe(false);
    await restored.finish(); expect(await restored.pending()).toBe(false);
  });
});
