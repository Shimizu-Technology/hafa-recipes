import { beforeEach, it, expect, vi } from "vitest";
const f = vi.hoisted(() => ({
  map: new Map<string, string>(),
  files: vi.fn(),
  exports: vi.fn(),
  cancel: vi.fn(),
  scheduled: [] as Array<{ id: string; owner_scope: string }>,
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
    getAllKeys: async () => [...f.map.keys()],
  },
}));
vi.mock("./export-file", () => ({ cleanupPrivateExportFiles: f.exports }));
vi.mock("./capture-io", () => ({ cleanupCaptureFiles: f.files }));
vi.mock("./notifications-adapter", () => ({
  nativeNotifications: async () => ({ list: async () => f.scheduled, cancel: f.cancel }),
}));
import { erasePrivateDeviceData, recoverPrivateDeviceCleanup } from "./private-device";
beforeEach(() => {
  f.map.clear();
  f.files.mockReset();
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
    { id: "hafa-workouts:v1:AB%3Aworkouts%3A2:rest:1", owner_scope: "AB:workouts:2" },
  ];
  f.map.set("hafa-workouts:v1:AB:profile-edit%3A2", "other");
  await erasePrivateDeviceData("A", "binding");
  expect(f.cancel).toHaveBeenCalledTimes(1);
  expect(f.cancel).toHaveBeenCalledWith(f.scheduled[0].id);
  expect(f.map.get("hafa-workouts:v1:AB:profile-edit%3A2")).toBe("other");
});
