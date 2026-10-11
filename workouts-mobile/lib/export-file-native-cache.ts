import { Directory, File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { ExportSaveError, type ExportSaveResult } from "./export-save";

const localCleanupWarning = "The temporary private export could not be removed. Try local data cleanup before saving again.";
function withLocalCleanupWarning(primary: ExportSaveError) {
  return Object.assign(new ExportSaveError(`${primary.message} ${localCleanupWarning}`),
    { status: primary.status, localCleanupWarning });
}

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
    const primary = new ExportSaveError("The private export could not be prepared on this device.");
    if (file) {
      try { removePrivateExportSource(file); }
      catch { throw withLocalCleanupWarning(primary); }
    }
    throw primary;
  }
}
export function removePrivateExportSource(file: File) {
  try { if (file.exists) file.delete(); }
  catch { throw new ExportSaveError(localCleanupWarning); }
}
export async function withPrivateExportSourceCleanup(file: File, work: () => Promise<ExportSaveResult>): Promise<ExportSaveResult> {
  let result: ExportSaveResult | undefined;
  let primary: ExportSaveError | undefined;
  try { result = await work(); }
  catch (error) {
    primary = error instanceof ExportSaveError ? error : new ExportSaveError("The export could not be saved. Your saved training has not changed.");
  }
  try { removePrivateExportSource(file); }
  catch {
    if (primary) throw withLocalCleanupWarning(primary);
    const outcome = result === "saved" ? "Your private export was saved." : result === "cancelled" ? "Saving was cancelled." : "The export file was opened for saving; the app cannot tell whether you saved a copy.";
    throw withLocalCleanupWarning(new ExportSaveError(outcome));
  }
  if (primary) throw primary;
  return result!;
}
export async function cleanupPrivateExportFiles(owner: string) {
  try {
    const folder = new Directory(Paths.cache, "hafa-workouts-private-exports", encodeURIComponent(owner));
    if (folder.exists) folder.delete();
  }
  catch { throw Error("The temporary private exports could not be removed. Try local data cleanup again."); }
}
