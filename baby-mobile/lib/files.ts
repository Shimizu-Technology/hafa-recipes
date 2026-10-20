import * as FileSystem from "expo-file-system/legacy";
import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import type { BabyApi } from "./api";
import type { LocalFile } from "./models";
import { storageKey } from "./vault";
import { fileExtension, supportedFileMime } from "./file-type";
export function directory(owner: string) {
  return `${FileSystem.documentDirectory}baby/${storageKey(owner)}/`;
}
export async function preserveFile(
  owner: string,
  file: { uri: string; name?: string; mimeType?: string; size?: number }
): Promise<LocalFile> {
  const mime = supportedFileMime(file.mimeType, file.name ?? file.uri);
  if (!mime)
    throw Object.assign(Error("Choose an image, PDF, audio, or video file."), { code: "unsupported_file" });
  const size = Platform.OS === "web" ? file.size : new File(file.uri).size;
  if (size != null && size > 25 * 1024 * 1024)
    throw Object.assign(Error("Choose a file smaller than 25 MB."), { code: "file_too_large" });
  const id = Crypto.randomUUID(),
    name = (file.name ?? "attachment").replace(/[^a-zA-Z0-9._-]/g, "_");
  if (Platform.OS === "web") return { id, uri: file.uri, name, mime_type: mime, size };
  await FileSystem.makeDirectoryAsync(directory(owner), { intermediates: true });
  const uri = directory(owner) + id + "-" + name;
  try {
    await FileSystem.copyAsync({ from: file.uri, to: uri });
  } catch (error) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    throw error;
  }
  return { id, uri, name, mime_type: mime, size };
}
export async function uploadFile(api: BabyApi, file: LocalFile, generation: number) {
  const body = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(file.uri)).blob();
    body.append("file", blob, file.name);
  } else {
    const original = new File(file.uri);
    Object.defineProperties(original, {
      name: { value: file.name },
      type: { value: file.mime_type },
    });
    if (original.size > 25 * 1024 * 1024) throw Error("Choose a file smaller than 25 MB.");
    // Expo 57's fetch requires a Blob or File; the old React Native URI part is unsupported.
    body.append("file", original);
  }
  return api.upload(body, generation, file.id);
}
export async function removeLocal(owner: string, uri: string) {
  if (Platform.OS !== "web" && uri.startsWith(directory(owner)))
    await FileSystem.deleteAsync(uri, { idempotent: true });
}
export async function clearFiles(owner: string) {
  if (Platform.OS !== "web") await FileSystem.deleteAsync(directory(owner), { idempotent: true });
}
export async function openAttachment(
  api: BabyApi,
  id: string,
  getToken: () => Promise<string | null>,
  owner: string,
  current: () => boolean
) {
  if (Platform.OS === "web") throw Error("Open private attachments in the iPhone or Android app.");
  const lease = api.lease();
  const metadata = await api.attachment(id);
  const token = await getToken();
  api.assertLease(lease);
  if (!token || !current()) throw Error("Sign in again to open this attachment.");
  const suffix = "." + fileExtension(metadata.mime_type);
  const target = directory(owner) + "view-" + id + "-" + Crypto.randomUUID() + suffix;
  await FileSystem.makeDirectoryAsync(directory(owner), { intermediates: true });
  try {
    const result = await FileSystem.downloadAsync(api.attachmentUrl(id), target, {
      headers: { Authorization: `Bearer ${token}` },
    });
    api.assertLease(lease);
    if (!current()) throw Error("Your account changed.");
    if (result.status !== 200) throw Error("Could not open this attachment. Try again.");
    if (!(await Sharing.isAvailableAsync())) throw Error("This device cannot open the share sheet.");
    await Sharing.shareAsync(target, { mimeType: metadata.mime_type });
  } finally {
    await removeLocal(owner, target);
  }
}
export async function exportFile(value: unknown, owner: string) {
  if (Platform.OS === "web") throw Error("Export your private data from the iPhone or Android app.");
  await FileSystem.makeDirectoryAsync(directory(owner), { intermediates: true });
  const target = directory(owner) + "hafa-baby-export.json";
  await FileSystem.writeAsStringAsync(target, JSON.stringify(value, null, 2));
  try {
    await Sharing.shareAsync(target, { mimeType: "application/json", UTI: "public.json" });
  } finally {
    await removeLocal(owner, target);
  }
}
export async function exportVisit(text: string, owner: string) {
  if (Platform.OS === "web") throw Error("Share your visit summary from the installed app.");
  await FileSystem.makeDirectoryAsync(directory(owner), { intermediates: true });
  const target = directory(owner) + "doctor-questions.txt";
  await FileSystem.writeAsStringAsync(target, text);
  try {
    await Sharing.shareAsync(target, { mimeType: "text/plain", UTI: "public.plain-text" });
  } finally {
    await removeLocal(owner, target);
  }
}
