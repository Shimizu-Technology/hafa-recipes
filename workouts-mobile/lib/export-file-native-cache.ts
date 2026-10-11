import { Directory, File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";

export function privateExportSource(value: unknown, owner: string, compact = false) {
  let file: File | null = null;
  try {
    const ownerScope = encodeURIComponent(owner);
    const folder = new Directory(Paths.cache, "hafa-workouts-private-exports", ownerScope);
    folder.create({ intermediates: true, idempotent: true });
    const sourceId = Crypto.randomUUID();
    file = new File(folder, `hafa-workouts-export-${sourceId}.json`);
    file.create();
    file.write(compact ? JSON.stringify(value) : JSON.stringify(value, null, 2));
    return { file, sourceId, ownerScope };
  } catch {
    if (file) removePrivateExportSource(file);
    throw Error("The private export could not be prepared on this device.");
  }
}
export function removePrivateExportSource(file: File) {
  try { if (file.exists) file.delete(); }
  catch { throw Error("The temporary private export could not be removed. Try local data cleanup before saving again."); }
}
export async function cleanupPrivateExportFiles(owner: string) {
  try {
    const folder = new Directory(Paths.cache, "hafa-workouts-private-exports", encodeURIComponent(owner));
    if (folder.exists) folder.delete();
  }
  catch { throw Error("The temporary private exports could not be removed. Try local data cleanup again."); }
}
