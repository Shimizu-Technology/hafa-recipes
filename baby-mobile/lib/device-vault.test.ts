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
  it("keeps every event through a relaunch, behind any number of newer logs", () => {
    const logs = Array.from({ length: 300 }, (_, n) => row(`source-${n}`, "source")),
      old = optimisticRecord({ id: "weekly-class", kind: "event", title: "Class", body: "", child_id: null, occurred_at: "2020-01-01T00:00:00Z", data: {} }),
      kept = persistedCache("records", [...logs, old]) as typeof logs;
    expect(kept.map((row) => row.id)).toContain("weekly-class");
    expect(kept).toHaveLength(201);
  });
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

describe("where a family save lives", () => {
  it("sits outside the directory and key names build 35 deletes when it signs out", async () => {
    vi.resetModules();
    const held = new Map<string, string>(), disk = new Map<string, string>();
    vi.doMock("react-native", () => ({ Platform: { OS: "ios" } }));
    vi.doMock("expo-file-system/legacy", () => ({
      documentDirectory: "file:///docs/",
      makeDirectoryAsync: async () => undefined,
      writeAsStringAsync: async (name: string, value: string) => { disk.set(name, value); },
      readAsStringAsync: async (name: string) => disk.get(name)!,
      deleteAsync: async (name: string) => { for (const key of [...disk.keys()]) if (key.startsWith(name)) disk.delete(key); },
    }));
    vi.doMock("expo-crypto", () => {
      const key = { encoded: async () => "k" };
      return {
        AESEncryptionKey: { generate: async () => key, import: async () => key },
        AESSealedData: { fromCombined: (value: string) => value },
        aesEncryptAsync: async (bytes: Uint8Array) => ({ combined: () => new TextDecoder().decode(bytes) }),
        aesDecryptAsync: async (value: string) => new TextEncoder().encode(value),
      };
    });
    const { createDeviceVault } = await import("./device-vault"), { storageKey } = await import("./vault"), { emptyState } = await import("./models");
    const secret = { getItemAsync: async (k: string) => held.get(k) ?? null, setItemAsync: async (k: string, v: string) => { held.set(k, v); }, deleteItemAsync: async (k: string) => { held.delete(k); } };
    let id = 0;
    const make = () => createDeviceVault(secret, "n", () => String(++id));
    const family = { ...emptyState(), bootstrap: { generation: 1, personal_space_id: "p", spaces: [{ id: "p", kind: "personal" }, { id: "f", kind: "family" }], children: [] }, outbox: [{ id: "tap", space_id: "f" }] };
    await make().write(family);
    // What build 35's own sign-out removes, by name.
    const name = storageKey("n");
    expect([...disk.keys()].filter((key) => key.startsWith(`file:///docs/baby-vault/${name}/`))).toEqual([]);
    expect(held.has(name + ".key")).toBe(false);
    held.delete(name + ".manifest");
    expect(await make().read()).toMatchObject({ outbox: [{ id: "tap" }], feedNotices: [expect.stringContaining("signed out on an older version")] });
    await make().clear();
    expect(disk.size).toBe(0);
    expect(held.size).toBe(0);
    vi.doUnmock("react-native"); vi.doUnmock("expo-file-system/legacy"); vi.doUnmock("expo-crypto");
  });
});
