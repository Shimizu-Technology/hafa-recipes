import { describe, expect, it, vi } from "vitest";
import { collectSnapshotExport, type ExportManifest, type ExportPage, type SnapshotPage } from "./account";
import { requireSameExportManifest } from "./export-save";
import { sameExportTotals } from "./export-totals";

// Frozen API 7139 export schema. Empty datasets remain keys in the real manifest.
const names = [
  "workouts", "workout_versions", "programs", "program_versions", "sessions", "activities",
  "imports", "proposals", "coach_messages", "health_connections", "health_observations",
  "health_owned_writes", "recipe_connection_receipts", "published_training_shares",
  "training_copy_receipts", "library_organization", "library_collections",
  "library_collection_members", "library_duplicate_receipts", "measurements",
  "completed_activity_log", "recipe_grant_epoch", "import_allowance_receipts",
];
function totals(workouts = 3) {
  return Object.fromEntries(names.map((name) => [name,
    name === "workouts" || name === "workout_versions" ? workouts : name === "sessions" ? 2 : 0]));
}
function reversed(value: Record<string, number>) {
  return Object.fromEntries(Object.entries(value).reverse());
}
function fixture(workouts = 3) {
  const counts = totals(workouts);
  const manifest: ExportManifest = {
    id: "synthetic-fixed-snapshot", generation: 2, schema_version: 1, page_size: 10,
    page_count: Math.ceil(workouts / 10), created_at: "2026-10-11T00:00:00Z",
    expires_at: new Date(Date.now() + 600_000).toISOString(), totals: reversed(counts),
  };
  const rows: ExportPage["datasets"] = Object.fromEntries(names.map((name) => [name, []]));
  rows.workouts = Array.from({ length: workouts }, (_, index) => ({ id: `workout-${index}`, revision: 1,
    content: { title: `Synthetic workout ${index}`, provenance: "user" } }));
  rows.workout_versions = rows.workouts.map((row, index) => ({ ...row, id: `version-${index}`, workout_id: row.id }));
  rows.sessions = [
    { id: "actual-original", content: { actuals: [{ reps: 7, completed: true }] } },
    { id: "actual-correction", content: { supersedes_session_id: "actual-original", actuals: [{ reps: 6, completed: true }] } },
  ];
  function page(index: number): SnapshotPage {
    const offset = index * 10;
    return { snapshot_id: manifest.id, page: index, page_count: manifest.page_count, export: {
      schema_version: 1, generated_at: manifest.created_at,
      enrollment: { generation: 2, enrolled: true, disclosure_version: 1, adult_confirmed: true,
        shared_account_deletion_acknowledged: true, enrolled_at: manifest.created_at },
      profile: null, profile_revision: 4, ai_consent: { accepted: false, disclosure_version: 1, accepted_at: null },
      grants: [], offset, limit: 10, totals: index % 2 ? reversed(counts) : { ...counts },
      datasets: Object.fromEntries(names.map((name) => [name, rows[name].slice(offset, offset + 10)])),
      has_more: Object.fromEntries(names.map((name) => [name, counts[name] > offset + 10])),
    } };
  }
  return { manifest, page, rows };
}

describe("private export totals across JSONB and encrypted JSON", () => {
  it("accepts the same 23 keys in opposite orders and retains both actual historical events", async () => {
    const f = fixture();
    expect(Object.keys(f.manifest.totals)).toHaveLength(23);
    expect(JSON.stringify(f.manifest.totals)).not.toBe(JSON.stringify(f.page(0).export.totals));
    const guard = vi.fn();
    const result = await collectSnapshotExport(f.manifest, async (index) => f.page(index), guard);
    expect(result.datasets).toEqual(f.rows);
    expect(result.datasets.workouts).toHaveLength(3);
    expect(result.datasets.workout_versions).toHaveLength(3);
    expect(result.datasets.sessions.map((row) => row.content)).toEqual(f.rows.sessions.map((row) => row.content));
    expect(result.snapshot.id).toBe(f.manifest.id);
    expect(guard).toHaveBeenCalled();
    // The save-time endpoint reconstructs its totals from the encrypted page.
    expect(() => requireSameExportManifest(f.manifest, { ...f.manifest, totals: f.page(0).export.totals })).not.toThrow();
  });

  it("accepts key reordering between pages while collecting each saved record once", async () => {
    const f = fixture(11);
    const result = await collectSnapshotExport(f.manifest, async (index) => f.page(index), () => {});
    expect(result.datasets).toEqual(f.rows);
    expect(result.datasets.workouts).toHaveLength(11);
    expect(result.datasets.workout_versions).toHaveLength(11);
    expect(result.datasets.sessions).toHaveLength(2);
  });

  it.each([
    ["changed count", (value: Record<string, number>) => ({ ...value, sessions: 3 })],
    ["missing empty dataset", (value: Record<string, number>) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "programs"))],
    ["extra empty dataset", (value: Record<string, number>) => ({ ...value, unknown_dataset: 0 })],
  ] as const)("rejects %s at collection and final save", async (_, change) => {
    const f = fixture(11);
    await expect(collectSnapshotExport(f.manifest, async (index) => {
      const page = f.page(index);
      if (index === 1) page.export.totals = change(page.export.totals);
      return page;
    }, () => {})).rejects.toThrow("private snapshot changed");
    expect(() => requireSameExportManifest(f.manifest, { ...f.manifest, totals: change(f.manifest.totals) }))
      .toThrow("changed or expired");
  });

  it.each([NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "3", null, undefined, true])(
    "rejects invalid counts even when both inputs contain the same invalid value: %s", (count) => {
      const invalid = { ...totals(), sessions: count };
      expect(sameExportTotals(invalid, reversed(invalid as Record<string, number>))).toBe(false);
      const f = fixture();
      const manifest = { ...f.manifest, totals: invalid as Record<string, number> };
      expect(() => requireSameExportManifest(manifest, { ...manifest })).toThrow("changed or expired");
    }
  );

  it.each([null, undefined, [], 3, "{}", new Date(0), new Map(), Object.create({ workouts: 3 })])(
    "rejects malformed totals containers: %s", (value) => {
      expect(sameExportTotals(value, value)).toBe(false);
    }
  );

  it.each([
    ["snapshot identity", (page: SnapshotPage) => { page.snapshot_id = "another-snapshot"; }],
    ["page index", (page: SnapshotPage) => { page.page = 0; }],
    ["page count", (page: SnapshotPage) => { page.page_count = 3; }],
    ["generation", (page: SnapshotPage) => { page.export.enrollment.generation = 3; }],
    ["profile revision", (page: SnapshotPage) => { page.export.profile_revision++; }],
    ["permission", (page: SnapshotPage) => { page.export.grants = [{ scope: "recipes_library_context", granted_at: "2026-10-11T00:00:00Z" }]; }],
    ["consent", (page: SnapshotPage) => { page.export.ai_consent = { accepted: true }; }],
    ["paging", (page: SnapshotPage) => { page.export.offset = 0; }],
    ["incomplete sequence", (page: SnapshotPage) => { page.export.has_more.workouts = true; }],
    ["duplicate record", (page: SnapshotPage) => { page.export.datasets.workouts[0].id = "workout-0"; }],
    ["missing record", (page: SnapshotPage) => { page.export.datasets.workouts = []; }],
  ] as const)("still rejects a second-page %s change", async (_, change) => {
    const f = fixture(11);
    await expect(collectSnapshotExport(f.manifest, async (index) => {
      const page = f.page(index);
      if (index === 1) change(page);
      return page;
    }, () => {})).rejects.toThrow();
  });

  it("still stops a retired owner operation before accepting reordered totals", async () => {
    const f = fixture();
    const guard = vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => {}).mockImplementation(() => {
      throw Error("Owner scope retired");
    });
    await expect(collectSnapshotExport(f.manifest, async (index) => f.page(index), guard)).rejects.toThrow("Owner scope retired");
  });
});
