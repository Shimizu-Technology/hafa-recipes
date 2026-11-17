import { beforeEach, it, expect, vi } from "vitest";
const f = vi.hoisted(() => ({
  map: new Map<string, string>(),
  files: vi.fn(),
  clearPlans: vi.fn(),
  purgeResults: vi.fn(),
  journals: vi.fn(),
  exports: vi.fn(),
  cancel: vi.fn(),
  scheduled: [] as Array<{ id: string; owner_scope: string }>
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => f.map.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      f.map.set(key, value);
    },
    removeItem: async (key: string) => {
      f.map.delete(key);
    },
    getAllKeys: async () => [...f.map.keys()]
  }
}));
vi.mock("./watch-native", () => ({ nativeWatchBridge: async () => ({ purgeResults: f.purgeResults }), clearWatchPlans: f.clearPlans }));
vi.mock("./export-file", () => ({ cleanupPrivateExportFiles: f.exports }));
vi.mock("./capture-io", () => ({ cleanupCaptureFiles: f.files, recoverCaptureCleanup: f.journals }));
vi.mock("./notifications-adapter", () => ({
  nativeNotifications: async () => ({ list: async () => f.scheduled, cancel: f.cancel })
}));
import { DamagedCleanupRecordError, erasePrivateDeviceData, recoverPrivateDeviceCleanup } from "./private-device";
beforeEach(() => {
  f.map.clear();
  f.clearPlans.mockReset(); f.purgeResults.mockReset();
  f.files.mockReset();
  f.journals.mockReset();
  f.exports.mockReset();
  f.cancel.mockReset();
  f.scheduled = [];
});
it("durably queues authorized cleanup and recovers it without a server deletion replay", async () => {
  f.map.set("hafa-workouts:v1:A:capture%3A2", JSON.stringify({ files: [{ uri: "owned.jpg", owned: true }] }));
  f.files.mockRejectedValueOnce(Error("disk locked"));
  await expect(erasePrivateDeviceData("A", "binding")).rejects.toThrow("disk locked");
  expect(f.map.has("hafa-workouts:device-cleanup:v1:A")).toBe(true);
  f.files.mockResolvedValue(undefined);
  await recoverPrivateDeviceCleanup();
  expect(f.map.size).toBe(0);
  expect(f.files).toHaveBeenLastCalledWith([{ uri: "owned.jpg", owned: true }], true);
});
it("cancels only this exact owner notification namespace and preserves other draft owners", async () => {
  f.scheduled = [
    { id: "hafa-workouts:v1:A%3Aworkouts%3A2:rest:1", owner_scope: "A:workouts:2" },
    { id: "hafa-workouts:v1:AB%3Aworkouts%3A2:rest:1", owner_scope: "AB:workouts:2" }
  ];
  f.map.set("hafa-workouts:v1:AB:profile-edit%3A2", "other");
  await erasePrivateDeviceData("A", "binding");
  expect(f.cancel).toHaveBeenCalledTimes(1);
  expect(f.cancel).toHaveBeenCalledWith(f.scheduled[0].id);
  expect(f.map.get("hafa-workouts:v1:AB:profile-edit%3A2")).toBe("other");
});
it("erasure discovers superseded capture assets retained during failed replacement cleanup", async () => {
  const current = { uri: "current-owned.jpg", owned: true },
    superseded = { uri: "previous-owned.jpg", owned: true };
  f.map.set("hafa-workouts:v1:A:capture%3A2", JSON.stringify({ files: [current], cleanup_files: [superseded] }));
  f.map.set("hafa-workouts:v1:B:capture%3A2", JSON.stringify({ files: [{ uri: "B-owned.jpg", owned: true }] }));
  await erasePrivateDeviceData("A", "binding");
  expect(f.files).toHaveBeenCalledWith([current, superseded], true);
  expect(f.map.has("hafa-workouts:v1:B:capture%3A2")).toBe(true);
});
it("product erasure retries original-owner capture journals after removing drafts, and startup recovers late operations", async () => {
  f.map.set("hafa-workouts:v1:A:capture%3A2", JSON.stringify({ files: [] }));
  f.map.set("hafa-workouts:v1:B:capture%3A2", JSON.stringify({ files: [] }));
  f.journals.mockImplementation(async (owner?: string) => {
    if (owner === "A") expect(f.map.has("hafa-workouts:v1:A:capture%3A2")).toBe(false);
  });
  await erasePrivateDeviceData("A", "binding");
  expect(f.journals).toHaveBeenCalledWith("A");
  expect(f.map.has("hafa-workouts:v1:B:capture%3A2")).toBe(true);
  await recoverPrivateDeviceCleanup();
  expect(f.journals).toHaveBeenCalledWith();
});
it.each([
  ["unreadable", "{not json"],
  ["mismatched", JSON.stringify({ owner: "B", binding: "binding-B" })],
])("a %s cleanup record stops startup, and repair erases only the account named by its key", async (_, raw) => {
  f.map.set("hafa-workouts:device-cleanup:v1:A", raw);
  f.map.set("hafa-workouts:v1:A:profile%3A2", "PRIVATE_A");
  f.map.set("hafa-workouts:v1:B:profile%3A2", "PRIVATE_B");
  f.map.set("hafa-workouts:v1:binding-A:verified-identity", JSON.stringify({ id: "A", binding: "binding-A" }));
  f.map.set("hafa-workouts:v1:binding-B:verified-identity", JSON.stringify({ id: "B", binding: "binding-B" }));
  await expect(recoverPrivateDeviceCleanup()).rejects.toBeInstanceOf(DamagedCleanupRecordError);
  expect(f.map.get("hafa-workouts:v1:A:profile%3A2")).toBe("PRIVATE_A");
  await recoverPrivateDeviceCleanup({ repairDamaged: true });
  expect([...f.map.keys()].sort()).toEqual([
    "hafa-workouts:v1:B:profile%3A2",
    "hafa-workouts:v1:binding-B:verified-identity",
  ]);
  await recoverPrivateDeviceCleanup();
});

it("erasing the device clears watch plans and retains the inbox unless deleting the account", async () => {
  await erasePrivateDeviceData("A", "binding");
  expect(f.clearPlans).toHaveBeenCalledOnce(); expect(f.purgeResults).not.toHaveBeenCalled();
  await erasePrivateDeviceData("A", "binding", true);
  expect(f.purgeResults).toHaveBeenCalledExactlyOnceWith("A");
});
it("recovers a failed account-deletion watch purge before clearing the durable cleanup marker", async () => {
  f.purgeResults.mockRejectedValueOnce(Error("disk locked"));
  await expect(erasePrivateDeviceData("A", "binding", true)).rejects.toThrow("disk locked");
  expect(f.map.has("hafa-workouts:device-cleanup:v1:A")).toBe(true);
  await recoverPrivateDeviceCleanup();
  expect(f.purgeResults).toHaveBeenCalledTimes(2); expect(f.map.size).toBe(0);
});

it("watch push failures do not block erasure or account-deletion recovery", async () => {
  f.map.set("hafa-workouts:v1:A:profile%3A2", "PRIVATE");
  f.clearPlans.mockRejectedValue(Error("watchAppNotInstalled"));
  await erasePrivateDeviceData("A", "binding");
  expect(f.map.size).toBe(0);
  f.map.set("hafa-workouts:device-cleanup:v1:A", JSON.stringify({ owner: "A", binding: "binding", purgeWatch: true }));
  await recoverPrivateDeviceCleanup();
  expect(f.purgeResults).toHaveBeenCalledWith("A");
  expect(f.map.size).toBe(0);
});
