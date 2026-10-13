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
/** A cleanup record that cannot be read. Repair removes data only for the account named by its storage key. */
export class DamagedCleanupRecordError extends Error {}
// A damaged record loses its sign-in binding, so find the verified mapping that points at this owner.
async function forgetOwnerIdentity(owner: string) {
  for (const key of await AsyncStorage.getAllKeys()) {
    if (!key.startsWith("hafa-workouts:v1:") || !key.endsWith(":verified-identity")) continue;
    try {
      const value = JSON.parse((await AsyncStorage.getItem(key)) ?? "null") as { id?: unknown; binding?: unknown } | null;
      if (value?.id === owner && typeof value.binding === "string" &&
        key === `hafa-workouts:v1:${encodeURIComponent(value.binding)}:verified-identity`)
        await AsyncStorage.removeItem(key);
    } catch {
      // Unreadable mappings are not proven to belong to this owner; leave them.
    }
  }
}
export async function recoverPrivateDeviceCleanup(options: { repairDamaged?: boolean } = {}) {
  await recoverCaptureCleanup();
  for (const key of await AsyncStorage.getAllKeys()) {
    if (!key.startsWith(markerPrefix)) continue;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) continue;
    let entry: { owner?: unknown; binding?: unknown } | null = null;
    try {
      entry = JSON.parse(raw);
    } catch {
      // Handled below as a damaged record.
    }
    if (
      typeof entry?.owner === "string" &&
      typeof entry.binding === "string" &&
      key === markerPrefix + encodeURIComponent(entry.owner)
    ) {
      await erasePrivateDeviceData(entry.owner, entry.binding);
      continue;
    }
    if (!options.repairDamaged)
      throw new DamagedCleanupRecordError("A device cleanup record is damaged. Finish cleanup to continue.");
    // Only erasePrivateDeviceData writes this key, and it encodes the account being erased.
    // Trust the key, never the damaged contents, so no other account's data can be targeted.
    let owner = "";
    try {
      owner = decodeURIComponent(key.slice(markerPrefix.length));
    } catch {
      owner = "";
    }
    if (owner && key === markerPrefix + encodeURIComponent(owner)) {
      privateRegistry.retire(owner);
      await clean(owner);
      await forgetOwnerIdentity(owner);
    }
    await AsyncStorage.removeItem(key);
  }
}
