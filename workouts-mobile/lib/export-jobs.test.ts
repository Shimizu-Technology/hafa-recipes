import { describe, expect, it, vi } from "vitest";
import { createExportController, validateExportJob, type ExportJob, type ExportJobApi } from "./export-jobs";
import type { collectSnapshotExport } from "./account";
import { createExportJobStore, type ExportCommand } from "./export-job-store";
import { createPrivateStorageRegistry } from "./private-storage";
import type { SnapshotPage } from "./account";

const scope = { owner: "stable-account", generation: 2, backend: "https://fixture.invalid", binding: "test:issuer:subject" };
const manifest = { id: "snapshot-one", generation: 2, schema_version: 1 as const,
  created_at: "2026-10-11T00:00:00Z", expires_at: "2026-10-11T00:10:00Z", page_count: 2, page_size: 10 as const, totals: { workouts: 11 } };
const command: ExportCommand = { ...scope, schema_version: 1, request_id: "request-one", job_id: null, cancel_requested: false, retired: false };
function job(status: ExportJob["status"] = "queued", patch: Partial<ExportJob> = {}): ExportJob {
  return { schema_version: 1, id: "job-one", request_id: "request-one", generation: 2, status,
    admitted_at: "2026-10-11T00:00:00Z", deadline_at: "2026-10-11T00:02:00Z", expires_at: "2026-10-11T00:10:00Z",
    started_at: null, finished_at: null, failure_code: null, cleanup_pending: false,
    manifest: status === "ready" ? manifest : null, ...patch };
}
function page(index: number): SnapshotPage {
  return { snapshot_id: manifest.id, page: index, page_count: 2, export: {
    schema_version: 1, generated_at: manifest.created_at, enrollment: { enrolled: true, generation: 2,
      disclosure_version: 1, adult_confirmed: true, shared_account_deletion_acknowledged: true, enrolled_at: manifest.created_at },
    profile: null, profile_revision: 0, ai_consent: null, grants: [], totals: manifest.totals,
    datasets: { workouts: Array.from({ length: index === 0 ? 10 : 1 }, (_, row) => ({ id: `workout-${index * 10 + row}` })) },
    has_more: { workouts: index === 0 }, offset: index * 10, limit: 10 } };
}
function setup() {
  const map = new Map<string, string>();
  const raw = { getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => { map.set(key, value); },
    removeItem: async (key: string) => { map.delete(key); }, getAllKeys: async () => [...map.keys()] };
  const registry = createPrivateStorageRegistry(raw);
  const storage = registry.capture(scope.owner);
  let current = true;
  let next = 0;
  const api = {
    createExportJob: vi.fn<ExportJobApi["createExportJob"]>(async () => job()), exportJob: vi.fn<ExportJobApi["exportJob"]>(async () => job()),
    exportJobByRequest: vi.fn<ExportJobApi["exportJobByRequest"]>(async () => job()), cancelExportJob: vi.fn<ExportJobApi["cancelExportJob"]>(async () => job("cancelled")),
    exportSnapshotPage: vi.fn(async (_id: string, index: number) => page(index)),
  };
  const save = vi.fn<(data: Awaited<ReturnType<typeof collectSnapshotExport>>, owner: string, guard: () => void) => Promise<void>>(async () => undefined);
  const make = () => createExportController({ scope, storage, api, isCurrent: () => current && storage.isCurrent(),
    newRequestId: () => ++next === 1 ? "request-one" : `request-${next}`, save });
  return { map, raw, registry, storage, api, save, make, switchAccount: () => { current = false; },
    store: createExportJobStore(storage, scope, () => { if (!current || !storage.isCurrent()) throw Error("retired"); }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
describe("durable private export commands", () => {
  it("does not admit a job if its durable UUID cannot be stored", async () => {
    const s = setup(); s.raw.setItem = async () => { throw Error("Device storage unavailable"); };
    const c = s.make(); await c.start();
    expect(s.api.createExportJob).not.toHaveBeenCalled(); expect(c.state().error).toContain("storage unavailable");
  });
  it("persists a content-free immutable command before admission and resumes only the original handle after a cold restart", async () => {
    const s = setup();
    s.api.createExportJob.mockImplementation(async () => {
      expect((await s.store.load())?.request_id).toBe("request-one");
      throw Object.assign(Error("Connection interrupted"), { status: 0 });
    });
    const first = s.make(); await first.start(); first.dispose();
    expect(first.state().phase).toBe("uncertain");
    const restarted = s.make(); await restarted.restore();
    expect(s.api.createExportJob).toHaveBeenCalledTimes(1);
    expect(s.api.exportJobByRequest).toHaveBeenCalledWith("request-one", 2, expect.any(AbortSignal));
    expect(restarted.state().phase).toBe("preparing");
    expect(s.save).not.toHaveBeenCalled();
    expect(Object.keys(JSON.parse([...s.map.values()][0])).sort()).toEqual(
      ["schema_version", "owner", "generation", "backend", "binding", "request_id", "job_id", "cancel_requested", "retired"].sort());
  });
  it("does not recreate admission on a missing lookup; deliberate retry uses the same UUID", async () => {
    const s = setup(); await s.store.begin("request-one");
    s.api.exportJobByRequest.mockRejectedValue(Object.assign(Error("Not found"), { status: 404 }));
    const c = s.make(); await c.restore();
    expect(c.state().phase).toBe("uncertain"); expect(s.api.createExportJob).not.toHaveBeenCalled();
    await c.retryAdmission();
    expect(s.api.createExportJob).toHaveBeenCalledWith("request-one", 2, expect.any(AbortSignal));
  });
  it("retains uncertain cancellation and explicitly resolves the same admission before cancelling", async () => {
    const s = setup(); await s.store.begin("request-one");
    s.api.exportJobByRequest.mockRejectedValue(Object.assign(Error("Not found"), { status: 404 }));
    const c = s.make(); await c.restore(); await c.cancel();
    expect((await s.store.load())?.cancel_requested).toBe(true);
    expect(s.api.cancelExportJob).not.toHaveBeenCalled();
    c.dispose(); const cold = s.make(); await cold.restore();
    expect(s.api.createExportJob).not.toHaveBeenCalled();
    await cold.retryAdmission();
    expect(s.api.createExportJob).toHaveBeenCalledWith("request-one", 2, expect.any(AbortSignal));
    expect(s.api.cancelExportJob).toHaveBeenCalledWith("job-one", 2, expect.any(AbortSignal));
    expect(cold.state().job?.status).toBe("cancelled");
  });
  it("downloads from page zero on explicit retry and never saves a partial file or replaces the snapshot", async () => {
    const s = setup(); s.api.createExportJob.mockResolvedValue(job("ready")); s.api.exportJob.mockResolvedValue(job("ready"));
    const c = s.make(); await c.start();
    s.api.exportSnapshotPage.mockImplementationOnce(async () => page(0))
      .mockRejectedValueOnce(Object.assign(Error("Offline"), { status: 0 }));
    await c.save();
    expect(s.save).not.toHaveBeenCalled(); expect(s.api.cancelExportJob).not.toHaveBeenCalled();
    expect(c.state().phase).toBe("ready"); expect(c.state().invalidated).toBe(false);
    await c.save();
    expect(s.api.exportSnapshotPage.mock.calls.map((args) => args.slice(0, 3))).toEqual([
      ["snapshot-one", 0, 2], ["snapshot-one", 1, 2], ["snapshot-one", 0, 2], ["snapshot-one", 1, 2] ]);
    expect(s.save).toHaveBeenCalledTimes(1);
    expect(s.save.mock.calls[0][0].datasets.workouts).toHaveLength(11);
    expect(s.api.createExportJob).toHaveBeenCalledTimes(1);
    expect(s.api.cancelExportJob).toHaveBeenCalledWith("job-one", 2);
    expect(c.state().message).toContain("cannot tell whether you saved");
  });
  it("fences a revoked page and requires deliberate cleanup before a new request", async () => {
    const s = setup(); s.api.createExportJob.mockResolvedValue(job("ready")); s.api.exportJob.mockResolvedValue(job("ready"));
    const c = s.make(); await c.start();
    s.api.exportSnapshotPage.mockRejectedValue(Object.assign(Error("Privacy changed"), { status: 410 }));
    await c.save(); expect(c.state().invalidated).toBe(true); expect(s.save).not.toHaveBeenCalled();
    await c.start(); expect(s.api.createExportJob).toHaveBeenCalledTimes(1);
    await c.cancel();
    s.api.createExportJob.mockResolvedValue(job("queued", { request_id: "request-2", id: "job-two" }));
    await c.start();
    expect(s.api.createExportJob).toHaveBeenLastCalledWith("request-2", 2, expect.any(AbortSignal));
  });
  it("persists save cleanup intent before the OS sheet and cleans the same READY job even if the sheet errors", async () => {
    const s = setup(); s.api.createExportJob.mockResolvedValue(job("ready")); s.api.exportJob.mockResolvedValue(job("ready"));
    s.save.mockImplementation(async () => {
      expect((await s.store.load())?.cancel_requested).toBe(true);
      throw Error("Save options unavailable");
    });
    const c = s.make(); await c.start(); await c.save();
    expect(s.api.cancelExportJob).toHaveBeenCalledWith("job-one", 2);
    expect(c.state().job?.status).toBe("cancelled");
    expect(c.state().error).toBe("Save options unavailable");
  });
  it("retains an unacknowledged post-sheet cleanup handle across restart; no automatic second sheet or enqueue", async () => {
    const s = setup(); s.api.createExportJob.mockResolvedValue(job("ready")); s.api.exportJob.mockResolvedValue(job("ready"));
    s.api.cancelExportJob.mockRejectedValue(Object.assign(Error("Offline cleanup"), { status: 0 }));
    const c = s.make(); await c.start(); await c.save(); c.dispose();
    const restored = s.make(); await restored.restore();
    expect(restored.state().phase).toBe("cancelling");
    expect(s.save).toHaveBeenCalledTimes(1); expect(s.api.createExportJob).toHaveBeenCalledTimes(1);
    s.api.cancelExportJob.mockResolvedValue(job("cancelled")); await restored.cancel();
    expect(restored.state().job?.status).toBe("cancelled");
  });
  it("does not invent cleanup completion or a new request while an interrupted worker still owns the slot", async () => {
    const s = setup(); s.api.createExportJob.mockResolvedValue(job("failed", { failure_code: "interrupted", cleanup_pending: true }));
    const c = s.make(); await c.start(); await c.start();
    expect(c.state().job?.cleanup_pending).toBe(true); expect(s.api.createExportJob).toHaveBeenCalledTimes(1);
    expect(s.save).not.toHaveBeenCalled();
  });
  it("drops late admission after account switch and cannot recreate erased device storage", async () => {
    const s = setup(); const delayed = deferred<ExportJob>(); s.api.createExportJob.mockReturnValue(delayed.promise);
    const c = s.make(); const work = c.start();
    await vi.waitFor(() => expect(s.api.createExportJob).toHaveBeenCalledTimes(1));
    s.switchAccount(); await s.registry.erase(scope.owner); delayed.resolve(job()); await work;
    expect(s.map.size).toBe(0); expect(c.state().job).toBeNull(); expect(s.api.cancelExportJob).not.toHaveBeenCalled();
  });
  it("pauses and aborts in-flight checking without losing the admission intent; later focus recovers read-only", async () => {
    const s = setup(); const delayed = deferred<ExportJob>(); s.api.createExportJob.mockReturnValue(delayed.promise);
    const c = s.make(); const work = c.start();
    await vi.waitFor(() => expect(s.api.createExportJob).toHaveBeenCalledTimes(1));
    c.pause(); expect(s.api.createExportJob.mock.calls[0][2]?.aborted).toBe(true);
    delayed.resolve(job()); await work;
    expect((await s.store.load())?.request_id).toBe("request-one");
    await c.restore(); expect(c.state().phase).toBe("preparing"); expect(s.api.createExportJob).toHaveBeenCalledTimes(1);
  });
  it("serializes competing controller admissions and prevents stale store responses overwriting a fresh intent", async () => {
    const s = setup(); const delayed = deferred<ExportJob>(); s.api.createExportJob.mockReturnValue(delayed.promise);
    const first = s.make(); const second = s.make(); const pending = first.start();
    await vi.waitFor(() => expect(s.api.createExportJob).toHaveBeenCalledTimes(1));
    await second.start(); expect(s.api.createExportJob).toHaveBeenCalledTimes(1);
    delayed.resolve(job()); await pending;
    await s.store.retire("request-one"); await s.store.begin("new-request");
    await expect(s.store.attach("request-one", "job-one")).rejects.toThrow("command changed");
    expect((await s.store.load())?.request_id).toBe("new-request");
  });
  it("refuses invalid scope/status/manifest/provider error fields instead of exposing or saving them", () => {
    expect(() => validateExportJob(job("ready", { generation: 99 }), command)).toThrow();
    expect(() => validateExportJob(job("ready", { manifest: { ...manifest, page_count: 513 } }), command)).toThrow();
    expect(() => validateExportJob(job("failed", { failure_code: "raw provider body" as ExportJob["failure_code"] }), command)).toThrow();
    expect(() => validateExportJob(job("running", { manifest }), command)).toThrow();
    expect(() => validateExportJob(job(), { ...command, job_id: "foreign-job" })).toThrow();
  });
});
