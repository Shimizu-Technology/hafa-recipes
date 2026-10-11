import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createCaptureCleanupJournal, type CaptureCleanupLease, type CaptureAssetKind } from "./capture-cleanup";
import {
  boundedSource,
  type CaptureDraft,
  type CaptureFile,
  type ExtractionRequest,
  type CaptureGuard
} from "./capture";
async function nativeProcessIdentity() {
  const { requireOptionalNativeModule } = await import("expo-modules-core");
  const bridge = requireOptionalNativeModule<{ nativeProcessIdentity(): string }>("HafaPausedHealth");
  if (!bridge?.nativeProcessIdentity) throw Error("Use an updated installed app to capture files.");
  return bridge.nativeProcessIdentity();
}
const journal = createCaptureCleanupJournal(
  AsyncStorage,
  () => FileSystem.cacheDirectory,
  (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
  nativeProcessIdentity
);
export const recoverCaptureCleanup = (owner?: string) => journal.recover(owner);
const ownedPrefix = () => {
  if (!FileSystem.cacheDirectory) throw Error("File capture requires an installed native app.");
  return `${FileSystem.cacheDirectory}hafa-workouts-capture/`;
};
async function ownFile(
  uri: string,
  extension: string,
  guard: CaptureGuard,
  lease: CaptureCleanupLease
): Promise<string> {
  guard();
  const prefix = ownedPrefix();
  const dest = `${prefix}${Crypto.randomUUID()}.${extension}`;
  // The exact destination is durable before any native write can create bytes.
  await lease.remember([{ uri: dest, kind: "capture" }]);
  guard();
  await FileSystem.makeDirectoryAsync(prefix, { intermediates: true });
  guard();
  await lease.native("known", () => FileSystem.copyAsync({ from: uri, to: dest }), undefined, guard);
  guard();
  return dest;
}
type ImageInputs = Array<{ uri: string; width?: number | null; height?: number | null; name?: string }>;
const sdkKinds: CaptureAssetKind[] = ["picker", "document", "manipulator"];
async function normalized(
  inputs: ImageInputs,
  guard: CaptureGuard,
  lease: CaptureCleanupLease
): Promise<CaptureFile[]> {
  guard();
  if (inputs.length > 4) throw Error("Choose up to four images.");
  const output: CaptureFile[] = [];
  for (const input of inputs) {
    let image: ImageManipulator.ImageResult | null = null;
    for (const max of [1600, 1200, 900]) {
      guard();
      const width =
        input.width && input.height
          ? Math.max(1, Math.round(input.width * Math.min(1, max / Math.max(input.width, input.height))))
          : max;
      image = await lease.native(
        "opaque",
        () => {
          return ImageManipulator.manipulateAsync(input.uri, [{ resize: { width } }], {
            format: ImageManipulator.SaveFormat.JPEG,
            compress: 0.65,
            base64: true
          });
        },
        (result) =>
          result.uri !== input.uri &&
          result.uri.startsWith(
            FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}ImageManipulator/` : "not-cache:"
          )
            ? [{ uri: result.uri, kind: "manipulator" }]
            : [],
        guard
      );
      guard();
      if ((image.base64?.length ?? Infinity) * 0.75 <= 300 * 1024) break;
    }
    if (!image?.base64 || image.base64.length * 0.75 > 350 * 1024)
      throw Error("That image is still too large. Crop the workout or use clearer screenshots.");
    const uri = await ownFile(image.uri, "jpg", guard, lease);
    output.push({ uri, mime_type: "image/jpeg", name: input.name ?? "Workout image", owned: true });
  }
  return output;
}
export async function normalizeImages(inputs: ImageInputs, guard: CaptureGuard, owner: string): Promise<CaptureFile[]> {
  guard();
  const lease = await journal.begin(owner, Crypto.randomUUID());
  try {
    const output = await normalized(inputs, guard, lease);
    await lease.finish();
    await lease.cleanup(sdkKinds);
    guard();
    return output;
  } catch (error) {
    try {
      await lease.finish();
    } finally {
      await lease.cleanup();
    }
    throw error;
  }
}
export async function pickImages(camera: boolean, guard: CaptureGuard, owner: string): Promise<CaptureFile[]> {
  guard();
  const lease = await journal.begin(owner, Crypto.randomUUID());
  try {
    guard();
    if (camera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      guard();
      if (!permission.granted)
        throw Error("Camera access is off. You can choose an existing image or paste text instead.");
    }
    const sdkPrefix = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}ImagePicker/` : null;
    const result = await lease.native(
      "opaque",
      () => {
        return camera
          ? ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
          : ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              allowsMultipleSelection: true,
              selectionLimit: 4,
              quality: 1
            });
      },
      (result) =>
        result.canceled
          ? []
          : result.assets
              .filter((a) => sdkPrefix && a.uri.startsWith(sdkPrefix))
              .map((a) => ({ uri: a.uri, kind: "picker" })),
      guard
    );
    if (result.canceled) {
      guard();
      await lease.finish();
      await lease.cleanup();
      return [];
    }
    guard();
    const output = await normalized(
      result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height, name: a.fileName ?? undefined })),
      guard,
      lease
    );
    await lease.finish();
    await lease.cleanup(sdkKinds);
    guard();
    return output;
  } catch (error) {
    try {
      await lease.finish();
    } finally {
      await lease.cleanup();
    }
    throw error;
  }
}
export async function pickDocument(guard: CaptureGuard, owner: string): Promise<CaptureFile[]> {
  guard();
  const lease = await journal.begin(owner, Crypto.randomUUID());
  try {
    guard();
    const sdkPrefix = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}DocumentPicker/` : null;
    const result = await lease.native(
      "opaque",
      () => {
        return DocumentPicker.getDocumentAsync({
          type: ["application/pdf", "text/plain", "text/markdown"],
          copyToCacheDirectory: true,
          multiple: false
        });
      },
      (result) =>
        result.canceled
          ? []
          : result.assets
              .filter((a) => sdkPrefix && a.uri.startsWith(sdkPrefix))
              .map((a) => ({ uri: a.uri, kind: "document" })),
      guard
    );
    if (result.canceled) {
      guard();
      await lease.finish();
      await lease.cleanup();
      return [];
    }
    guard();
    const file = result.assets[0];
    if ((file.size ?? 0) > 128 * 1024)
      throw Error("Use a document under 128 KB, paste the text, or choose screenshots of the workout.");
    const uri = await ownFile(file.uri, file.mimeType === "application/pdf" ? "pdf" : "txt", guard, lease);
    await lease.finish();
    await lease.cleanup(sdkKinds);
    guard();
    return [{ uri, mime_type: file.mimeType ?? "text/plain", name: file.name, owned: true }];
  } catch (error) {
    try {
      await lease.finish();
    } finally {
      await lease.cleanup();
    }
    throw error;
  }
}
export async function sourceFor(draft: CaptureDraft, guard: CaptureGuard): Promise<ExtractionRequest> {
  guard();
  const source: ExtractionRequest = { kind: draft.kind, ai_consent: true };
  if (draft.text.trim()) source.text = draft.text.trim();
  if (draft.kind === "url") source.source_url = draft.source_url.trim();
  if (draft.kind === "images")
    source.images = await Promise.all(
      draft.files.map(async (file) => {
        guard();
        const base64_data = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
        guard();
        return { base64_data, mime_type: file.mime_type };
      })
    );
  if (draft.kind === "document") {
    const file = draft.files[0];
    const info = await FileSystem.getInfoAsync(file.uri);
    guard();
    if (!info.exists || info.isDirectory || info.size > 128 * 1024)
      throw Error("The document is unavailable or too large. Choose it again or paste its text.");
    source.document_base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
    source.document_mime = file.mime_type;
  }
  guard();
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
