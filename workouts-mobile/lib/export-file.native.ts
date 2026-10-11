import * as Sharing from "expo-sharing";
import { privateExportSource, withPrivateExportSourceCleanup } from "./export-file-native-cache";
import { ExportSaveError, type ExportSaveOptions, type ExportSaveResult } from "./export-save";
export { cleanupPrivateExportFiles } from "./export-file-native-cache";
export async function savePrivateExport(value: unknown, owner: string, guard: () => void, _options?: ExportSaveOptions): Promise<ExportSaveResult> {
  if (!(await Sharing.isAvailableAsync()))
    throw Error("This device cannot open a file share sheet. Your saved data has not changed.");
  guard();
  const { file } = privateExportSource(value, owner);
  return withPrivateExportSourceCleanup(file, async () => {
    guard();
    try {
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/json",
        UTI: "public.json",
        dialogTitle: "Save your private Håfa Workouts export",
      });
    } catch {
      throw new ExportSaveError("The save options could not be opened. Your saved training has not changed.");
    }
    return "opened";
  });
}
