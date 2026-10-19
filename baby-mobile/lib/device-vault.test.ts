import { describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-file-system/legacy", () => ({}));
vi.mock("expo-crypto", () => ({}));
import { persistedCache } from "./device-vault";
import { createPartitionVault } from "./partition-vault";
import { emptyState, optimisticRecord, type DeviceState } from "./models";
const row = (id: string, kind: "source" | "routine") =>
  optimisticRecord({ id, kind, title: id, body: "", child_id: null, occurred_at: "2026-10-20T00:00:00Z", data: {} });
describe("routine cache persistence migration", () => {
  it("keeps every old routine independently of the recent nonroutine cache cap", () => {
    const records = [
      ...Array.from({ length: 220 }, (_, i) => row("source" + i, "source")),
      ...Array.from({ length: 205 }, (_, i) => row("old" + i, "routine")),
    ];
    const projected = persistedCache("records", records) as typeof records;
    expect(projected.filter((r) => r.kind === "source")).toHaveLength(200);
    expect(projected.filter((r) => r.kind === "routine")).toEqual(records.slice(220));
  });
  it("migrates legacy state without inventing completeness and persists scoped markers and local work", async () => {
    const secrets = new Map<string, string>(),
      disk = new Map<string, string>();
    let id = 0;
    const vault = createPartitionVault(
      {
        getItemAsync: async (k) => secrets.get(k) ?? null,
        setItemAsync: async (k, v) => {
          secrets.set(k, v);
        },
        deleteItemAsync: async (k) => {
          secrets.delete(k);
        },
      },
      "owner",
      () => String(++id),
      {
        read: async (k) => disk.get(k)!,
        write: async (k, v) => {
          disk.set(k, v);
        },
        remove: async (k) => {
          disk.delete(k);
        },
        clear: async () => {
          disk.clear();
        },
        seal: async (v) => v,
        open: async (v) => v,
      },
      persistedCache
    );
    const state = {
      ...emptyState(),
      records: [row("old", "routine")],
      outbox: [{ id: "local", generation: 1, type: "save" as const, record: row("new", "routine"), files: [] }],
    };
    await vault.write(state);
    expect((await vault.read<DeviceState>())!.routine_sync).toBeUndefined();
    const marker = { owner: "owner", generation: 1, complete: true, managed_ids: ["new"] };
    await vault.write({ ...state, routine_sync: marker });
    expect(await vault.read()).toEqual({ ...state, routine_sync: marker });
  });
});
