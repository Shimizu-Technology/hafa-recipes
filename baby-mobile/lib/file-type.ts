/** What the API takes: ALLOWED in api/app/domains/baby/attachments.py. A test reads it, so these can't drift apart. */
export const fileTypes = ["image/jpeg", "image/heic", "image/heif", "image/png", "image/webp", "image/gif", "application/pdf",
  "video/mp4", "video/quicktime", "video/webm", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg"];
/** The same container under another name, as Apple's resolver and other apps call it. */
const aliases: Record<string, string> = { "image/jpg": "image/jpeg", "audio/mp3": "audio/mpeg", "audio/x-mp3": "audio/mpeg",
  "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4", "audio/vnd.wave": "audio/wav", "audio/wave": "audio/wav" };
/**
 * The name the API knows this file by, or null if it won't take it, which is better said now than on every upload. Preserves
 * the actual media container: a filename is not a conversion. The same rule as plugins/BabyShareSheetState.swift.
 */
export function supportedFileMime(mime?: string, name?: string) {
  const normalized = mime?.split(";")[0].trim().toLowerCase();
  if (normalized && normalized !== "application/octet-stream") {
    const canonical = aliases[normalized] ?? normalized;
    return fileTypes.includes(canonical) ? canonical : null;
  }
  const extension = name?.split(".").pop()?.toLowerCase();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
    heic: "image/heic", heif: "image/heif", pdf: "application/pdf", mp4: "video/mp4", mov: "video/quicktime",
    webm: "video/webm", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg" } as Record<string, string>)[extension ?? ""] ?? null;
}
export function fileExtension(mime: string) {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/3gpp": "3gp", "video/x-m4v": "m4v", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm", "audio/ogg": "ogg" } as Record<string, string>)[mime.split(";")[0].trim().toLowerCase()] ?? "bin";
}
