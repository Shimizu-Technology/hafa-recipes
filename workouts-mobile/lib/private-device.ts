import { cleanupPrivateExportFiles } from "./export-file";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createPrivateStorageRegistry } from "./private-storage";
import { cleanupCaptureFiles, recoverCaptureCleanup } from "./capture-io";
import type { CaptureFile } from "./capture";
import { nativeNotifications } from "./notifications-adapter";
export const privateRegistry = createPrivateStorageRegistry(AsyncStorage);
const markerPrefix = "hafa-workouts:device-cleanup:v1:";
async function clean(owner: string) {
  await cleanupPrivateExportFiles(owner);
  const adapter = await nativeNotifications();
  for (const notification of await adapter.list()) {
    if (
      notification.owner_scope.startsWith(`${owner}:workouts:`) &&
      notification.id.startsWith(`hafa-workouts:v1:${encodeURIComponent(notification.owner_scope)}:`)
    )
      await adapter.cancel(notification.id);
  }
  await privateRegistry.erase(owner, async (raw) => {
    let value: { files?: CaptureFile[]; cleanup_files?: CaptureFile[] };
    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }
    const files = [
      ...(Array.isArray(value?.files) ? value.files : []),
      ...(Array.isArray(value?.cleanup_files) ? value.cleanup_files : [])
    ];
    if (files.length)
      await cleanupCaptureFiles(
        files.filter((file) => file && typeof file.uri === "string" && file.owned === true),
        true
      );
  });
  await recoverCaptureCleanup(owner);
}
export async function erasePrivateDeviceData(owner: string, binding: string) {
  privateRegistry.retire(owner);
  const key = markerPrefix + encodeURIComponent(owner);
  await AsyncStorage.setItem(key, JSON.stringify({ owner, binding }));
  await clean(owner);
  await AsyncStorage.removeItem(`hafa-workouts:v1:${encodeURIComponent(binding)}:verified-identity`);
  await AsyncStorage.removeItem(key);
}
export async function recoverPrivateDeviceCleanup() {
  await recoverCaptureCleanup();
  for (const key of await AsyncStorage.getAllKeys()) {
    if (!key.startsWith(markerPrefix)) continue;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) continue;
    let entry: { owner: string; binding: string };
    try {
      entry = JSON.parse(raw);
    } catch {
      throw Error("Device cleanup could not be restored. Contact support before opening private training.");
    }
    if (
      typeof entry.owner !== "string" ||
      typeof entry.binding !== "string" ||
      key !== markerPrefix + encodeURIComponent(entry.owner)
    )
      throw Error("Device cleanup metadata is invalid. Contact support.");
    await erasePrivateDeviceData(entry.owner, entry.binding);
  }
}
