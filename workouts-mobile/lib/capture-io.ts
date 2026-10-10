import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";
import { boundedSource, type CaptureDraft, type CaptureFile, type ExtractionRequest } from "./capture";
const ownedPrefix = () => {
  if (!FileSystem.cacheDirectory) throw Error("File capture requires an installed native app.");
  return `${FileSystem.cacheDirectory}hafa-workouts-capture/`;
};
async function ownFile(uri: string, extension: string): Promise<string> {
  const prefix = ownedPrefix();
  await FileSystem.makeDirectoryAsync(prefix, { intermediates: true });
  const dest = `${prefix}${Crypto.randomUUID()}.${extension}`;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest;
}
export async function normalizeImages(
  inputs: Array<{ uri: string; width?: number | null; height?: number | null; name?: string }>
): Promise<CaptureFile[]> {
  if (inputs.length > 4) throw Error("Choose up to four images.");
  const output: CaptureFile[] = [];
  try {
    for (const input of inputs) {
      let image: ImageManipulator.ImageResult | null = null;
      for (const max of [1600, 1200, 900]) {
        const width =
          input.width && input.height
            ? Math.max(1, Math.round(input.width * Math.min(1, max / Math.max(input.width, input.height))))
            : max;
        image = await ImageManipulator.manipulateAsync(input.uri, [{ resize: { width } }], {
          format: ImageManipulator.SaveFormat.JPEG,
          compress: 0.65,
          base64: true,
        });
        if ((image.base64?.length ?? Infinity) * 0.75 <= 300 * 1024) break;
        if (image.uri !== input.uri && image.uri.startsWith(FileSystem.cacheDirectory ?? "not-cache:"))
          await FileSystem.deleteAsync(image.uri, { idempotent: true });
      }
      if (!image?.base64 || image.base64.length * 0.75 > 350 * 1024)
        throw Error("That image is still too large. Crop the workout or use clearer screenshots.");
      const uri = await ownFile(image.uri, "jpg");
      output.push({ uri, mime_type: "image/jpeg", name: input.name ?? "Workout image", owned: true });
      if (image.uri !== input.uri && image.uri.startsWith(FileSystem.cacheDirectory ?? "not-cache:"))
        await FileSystem.deleteAsync(image.uri, { idempotent: true });
    }
    return output;
  } catch (e) {
    await cleanupCaptureFiles(output);
    throw e;
  }
}
export async function pickImages(camera = false): Promise<CaptureFile[]> {
  if (camera) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted)
      throw Error("Camera access is off. You can choose an existing image or paste text instead.");
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
    return result.canceled
      ? []
      : normalizeImages(
          result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height, name: a.fileName ?? undefined }))
        );
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: 4,
    quality: 1,
  });
  return result.canceled
    ? []
    : normalizeImages(
        result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height, name: a.fileName ?? undefined }))
      );
}
export async function pickDocument(): Promise<CaptureFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "text/plain", "text/markdown"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return [];
  const file = result.assets[0];
  if ((file.size ?? 0) > 128 * 1024)
    throw Error("Use a document under 128 KB, paste the text, or choose screenshots of the workout.");
  const uri = await ownFile(file.uri, file.mimeType === "application/pdf" ? "pdf" : "txt");
  return [{ uri, mime_type: file.mimeType ?? "text/plain", name: file.name, owned: true }];
}
export async function sourceFor(draft: CaptureDraft): Promise<ExtractionRequest> {
  const source: ExtractionRequest = { kind: draft.kind, ai_consent: true };
  if (draft.text.trim()) source.text = draft.text.trim();
  if (draft.kind === "url") source.source_url = draft.source_url.trim();
  if (draft.kind === "images")
    source.images = await Promise.all(
      draft.files.map(async (file) => ({
        base64_data: await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 }),
        mime_type: file.mime_type,
      }))
    );
  if (draft.kind === "document") {
    const file = draft.files[0];
    const info = await FileSystem.getInfoAsync(file.uri);
    if (!info.exists || info.isDirectory || info.size > 128 * 1024)
      throw Error("The document is unavailable or too large. Choose it again or paste its text.");
    source.document_base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
    source.document_mime = file.mime_type;
  }
  return boundedSource(source);
}
export async function cleanupCaptureFiles(files: CaptureFile[], strict = false) {
  const prefix = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}hafa-workouts-capture/` : null;
  if (!prefix) return;
  await Promise.all(
    files
      .filter((file) => file.owned && file.uri.startsWith(prefix))
      .map((file) =>
        FileSystem.deleteAsync(file.uri, { idempotent: true }).catch((error) => {
          if (strict) throw error;
        })
      )
  );
}
