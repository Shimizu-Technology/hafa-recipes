import * as Sharing from "expo-sharing";
import { privateExportSource, removePrivateExportSource } from "./export-file-native-cache";
import type { ExportSaveOptions, ExportSaveResult } from "./export-save";
export { cleanupPrivateExportFiles } from "./export-file-native-cache";
export async function savePrivateExport(value: unknown, owner: string, guard: () => void, _options?: ExportSaveOptions): Promise<ExportSaveResult> {
  if (!(await Sharing.isAvailableAsync()))
    throw Error("This device cannot open a file share sheet. Your saved data has not changed.");
  guard();
  const { file } = privateExportSource(value, owner);
  try {
    guard();
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/json",
      UTI: "public.json",
      dialogTitle: "Save your private Håfa Workouts export",
    });
    return "opened";
  } finally {
    removePrivateExportSource(file);
  }
}
