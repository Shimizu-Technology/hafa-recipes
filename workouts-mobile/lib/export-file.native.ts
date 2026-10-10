import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Crypto from "expo-crypto";
export async function savePrivateExport(value: unknown, owner: string, guard: () => void) {
  if (!(await Sharing.isAvailableAsync()))
    throw Error("This device cannot open a file share sheet. Your saved data has not changed.");
  guard();
  const folder = new Directory(Paths.cache, "hafa-workouts-private-exports", encodeURIComponent(owner));
  folder.create({ intermediates: true, idempotent: true });
  const file = new File(folder, `hafa-workouts-export-${Crypto.randomUUID()}.json`);
  try {
    file.create();
    file.write(JSON.stringify(value, null, 2));
    guard();
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/json",
      UTI: "public.json",
      dialogTitle: "Save your private Håfa Workouts export",
    });
  } finally {
    if (file.exists) file.delete();
  }
}

export async function cleanupPrivateExportFiles(owner: string) {
  const folder = new Directory(Paths.cache, "hafa-workouts-private-exports", encodeURIComponent(owner));
  if (folder.exists) folder.delete();
}
