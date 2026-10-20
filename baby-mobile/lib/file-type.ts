/** Preserve the actual media container; a filename is not a conversion. */
export function supportedFileMime(mime?: string, name?: string) {
  const normalized = mime?.split(";")[0].trim().toLowerCase();
  if (normalized && normalized !== "application/octet-stream")
    return /^(image\/[^*]+|video\/[^*]+|audio\/[^*]+|application\/pdf)$/.test(normalized) ? normalized : null;
  const extension = name?.split(".").pop()?.toLowerCase();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
    heic: "image/heic", heif: "image/heif", pdf: "application/pdf", mp4: "video/mp4", mov: "video/quicktime",
    webm: "video/webm", "3gp": "video/3gpp", m4v: "video/x-m4v", mp3: "audio/mpeg", m4a: "audio/mp4",
    aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg" } as Record<string, string>)[extension ?? ""] ?? null;
}
export function fileExtension(mime: string) {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/3gpp": "3gp", "video/x-m4v": "m4v", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm", "audio/ogg": "ogg" } as Record<string, string>)[mime.split(";")[0].trim().toLowerCase()] ?? "bin";
}
