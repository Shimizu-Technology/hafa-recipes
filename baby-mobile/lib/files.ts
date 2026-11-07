import * as FileSystem from "expo-file-system/legacy";
import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import type { BabyApi, Fence } from "./api";
import type { LocalFile } from "./models";
import { storageKey } from "./vault";
import { fileExtension, supportedFileMime } from "./file-type";
export function directory(owner: string) {
  return `${FileSystem.documentDirectory}baby/${storageKey(owner)}/`;
}
/** Making a file and clearing them take turns, so a clear decides what's staying knowing about every file made before it. */
let fileTurn: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>) {
  const run = fileTurn.then(work, work);
  fileTurn = run.catch(() => undefined);
  return run;
}
/** Made since the last clear, and maybe still on the way into a draft, where a clear can't see them yet. */
const justMade = new Set<string>();
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
  const uri = directory(owner) + id + "-" + name;
  await inTurn(async () => {
    await FileSystem.makeDirectoryAsync(directory(owner), { intermediates: true });
    try {
      await FileSystem.copyAsync({ from: file.uri, to: uri });
      justMade.add(uri);
    } catch (error) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      throw error;
    }
  });
  return { id, uri, name, mime_type: mime, size };
}
export async function uploadFile(api: BabyApi, file: LocalFile, generation: Fence) {
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
/** Everything under this account, or everything but what pending work needs, read when its turn comes. */
export function clearFiles(owner: string, staying?: () => ReadonlySet<string>, retiring?: () => ReadonlySet<string>) {
  if (Platform.OS === "web") return Promise.resolve();
  return inTurn(async () => {
    const retired = retiring?.(), keep = new Set([...(staying?.() ?? []), ...(staying ? [...justMade].filter((uri) => !retired?.has(uri)) : [])]);
    justMade.clear();
    if (!keep.size) return FileSystem.deleteAsync(directory(owner), { idempotent: true });
    const names = await FileSystem.readDirectoryAsync(directory(owner)).catch(() => [] as string[]);
    await Promise.all(names.filter((name) => !keep.has(directory(owner) + name)).map((name) => FileSystem.deleteAsync(directory(owner) + name, { idempotent: true })));
  });
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
      headers: { Authorization: `Bearer ${token}`, ...api.fileHeaders() },
      // Expo's default is a background session, which iOS can relaunch a closed app for.
      sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
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
/** Prints each level in turn until it fits one page and shares that. One that never fits isn't shared. Keeps no copy of any try. */
export async function exportOnePagePdf(html: (level: number) => string, lastLevel: number, owner: string, name: string) {
  if (Platform.OS === "web") throw Error("Share your summary from the installed app.");
  await FileSystem.makeDirectoryAsync(directory(owner), { intermediates: true });
  const target = directory(owner) + name, printed: string[] = [];
  let level = 0;
  try {
    for (;;) {
      const page = await Print.printToFileAsync({ html: html(level), width: 612, height: 792, margins: { top: 36, bottom: 36, left: 36, right: 36 } });
      printed.push(page.uri);
      if (page.numberOfPages > 1) {
        if (level === lastLevel) return { level, fits: false };
        level++;
        continue;
      }
      await FileSystem.deleteAsync(target, { idempotent: true });
      await FileSystem.moveAsync({ from: page.uri, to: target });
      await Sharing.shareAsync(target, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
      return { level, fits: true };
    }
  } finally {
    // Each on its own, so one that fails can't keep another or hide why the export stopped.
    await Promise.allSettled([...printed, target].map((uri) => FileSystem.deleteAsync(uri, { idempotent: true })));
  }
}
