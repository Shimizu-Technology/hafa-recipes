import { it, expect } from "vitest";
import { collectExport, type ExportPage } from "./account";
function page(offset = 0): ExportPage {
  return {
    schema_version: 1,
    generated_at: "2026-10-10T00:00:00Z",
    enrollment: {
      enrolled: true,
      generation: 2,
      disclosure_version: 1,
      adult_confirmed: true,
      shared_account_deletion_acknowledged: true,
      enrolled_at: null,
    },
    profile: null,
    profile_revision: 3,
    ai_consent: {},
    grants: [],
    datasets: { sessions: [] },
    totals: { sessions: 0 },
    has_more: { sessions: false },
    offset,
    limit: 10,
  };
}
it("assembles all datasets across pages and declares device-only scope", async () => {
  const data = await collectExport(
    async (offset) => ({
      ...page(offset),
      datasets: { sessions: Array.from({ length: offset === 0 ? 10 : 2 }, (_, i) => ({ id: String(offset + i) })) },
      totals: { sessions: 12 },
      has_more: { sessions: offset === 0 },
    }),
    2,
    () => {}
  );
  expect(data.datasets.sessions).toHaveLength(12);
  expect(data.notice).toContain("Device-only");
});
it("stops on enrollment, profile or total changes", async () => {
  await expect(
    collectExport(
      async () => ({ ...page(), enrollment: { ...page().enrollment, generation: 3 } }),
      2,
      () => {}
    )
  ).rejects.toThrow("changed");
  await expect(
    collectExport(
      async (offset) => ({ ...page(offset), profile_revision: offset ? 4 : 3, has_more: { sessions: true } }),
      2,
      () => {}
    )
  ).rejects.toThrow("changed");
});
it("fails an incomplete export or cancelled account operation", async () => {
  await expect(
    collectExport(
      async () => ({ ...page(), totals: { sessions: 1 } }),
      2,
      () => {}
    )
  ).rejects.toThrow("completely");
  await expect(
    collectExport(
      async () => page(),
      2,
      () => {
        throw Error("cancelled");
      }
    )
  ).rejects.toThrow("cancelled");
});

it("includes metadata and health projections with composite keys rather than invented record IDs", async () => {
  const data = await collectExport(
    async () => ({
      ...page(),
      datasets: {
        health_connections: [{ provider: "apple_health", revision: 1 }],
        library_collection_members: [{ collection_id: "collection", workout_id: "workout" }],
      },
      totals: { health_connections: 1, library_collection_members: 1 },
      has_more: { health_connections: false, library_collection_members: false },
    }),
    2,
    () => {}
  );
  expect(data.datasets.health_connections[0]).toEqual({ provider: "apple_health", revision: 1 });
});
import { collectSnapshotExport, type ExportManifest } from "./account";
const manifest: ExportManifest = {
  id: "captured-snapshot",
  generation: 2,
  schema_version: 1,
  created_at: "2026-10-10T00:00:00Z",
  expires_at: "2026-10-10T00:10:00Z",
  page_count: 1,
  page_size: 10,
  totals: { sessions: 0 },
};
it("exports only the captured fixed snapshot and never creates another during paging", async () => {
  const result = await collectSnapshotExport(
    manifest,
    async (number) => ({ snapshot_id: manifest.id, page: number, page_count: 1, export: page() }),
    () => {}
  );
  expect(result.snapshot.id).toBe(manifest.id);
  expect(result.notice).toContain("fixed snapshot");
});
it("discards snapshot identity changes and privacy invalidation rather than appending a new export", async () => {
  await expect(
    collectSnapshotExport(
      manifest,
      async (number) => ({ snapshot_id: "replacement", page: number, page_count: 1, export: page() }),
      () => {}
    )
  ).rejects.toThrow("snapshot changed");
  await expect(
    collectSnapshotExport(
      manifest,
      async () => {
        throw Error("Snapshot invalidated by privacy removal");
      },
      () => {}
    )
  ).rejects.toThrow("privacy removal");
});
