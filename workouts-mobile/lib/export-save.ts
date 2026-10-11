import type { ExportManifest } from "./account";
import { draftKey, type Storage } from "./drafts";

export type ExportSaveResult = "saved" | "cancelled" | "opened";
export class ExportSaveError extends Error {
  status?: number;
  localCleanupWarning?: string;
}
export interface ExportSaveOptions {
  signal?: AbortSignal;
  revalidate(): Promise<void>;
  onModal?(open: boolean): void;
}
export function exportSaveMessage(result: ExportSaveResult) {
  if (result === "saved") return "Your private export was saved. Keep the copy somewhere private.";
  if (result === "cancelled") return "Saving was cancelled. Your saved training has not changed.";
  return "The export file was opened for saving. The app cannot tell whether you saved it or closed the save options. Keep any copy private.";
}
export const interruptedSaveMessage = "A previous save was interrupted. Check the location you chose; a complete or incomplete file may remain there.";
export function legacySaveRecovery(storage: Storage, owner: string, generation: number) {
  const key = draftKey(owner, `legacy-export-save:${generation}`);
  return {
    async pending() {
      const value = await storage.getItem(key);
      if (value !== null && value !== "pending") throw Error("The previous save could not be checked. Try local data cleanup before saving again.");
      return value === "pending";
    },
    begin: () => storage.setItem(key, "pending"),
    finish: () => storage.removeItem(key),
  };
}
export function requireSameExportManifest(original: ExportManifest, current: ExportManifest) {
  const totals = (value: ExportManifest) => Object.entries(value.totals).sort(([a], [b]) => a.localeCompare(b));
  if (!current || current.id !== original.id || current.generation !== original.generation ||
      current.schema_version !== original.schema_version || current.page_size !== original.page_size ||
      current.page_count !== original.page_count || current.created_at !== original.created_at ||
      current.expires_at !== original.expires_at || !Number.isFinite(Date.parse(current.expires_at)) || Date.parse(current.expires_at) <= Date.now() ||
      JSON.stringify(totals(current)) !== JSON.stringify(totals(original)))
    throw Error("This export changed or expired while choosing where to save. Prepare a fresh export.");
}
