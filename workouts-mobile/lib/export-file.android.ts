import * as Crypto from "expo-crypto";
import { privateExportSource, withPrivateExportSourceCleanup } from "./export-file-native-cache";
import { saveDocument, type DocumentSaver } from "./save-document";
import type { ExportSaveOptions } from "./export-save";
export { cleanupPrivateExportFiles } from "./export-file-native-cache";

export async function savePrivateExport(value: unknown, owner: string, guard: () => void, options?: ExportSaveOptions) {
  guard();
  if (!options) throw Error("This export must be checked again before saving.");
  let saver: DocumentSaver | null = null;
  try {
    const { requireOptionalNativeModule } = await import("expo-modules-core");
    saver = requireOptionalNativeModule<DocumentSaver>("HafaDocumentSave");
  } catch { /* Missing/incompatible ABI must never select ambiguous sharing. */ }
  if (!saver) throw Error("Saving is unavailable in this app build. Update the app before trying again.");
  guard();
  const { file, sourceId, ownerScope } = privateExportSource(value, owner, true);
  return withPrivateExportSourceCleanup(file,
    () => saveDocument(saver, Crypto.randomUUID(), sourceId, ownerScope, guard, options));
}
