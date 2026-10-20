import { expect, it } from "vitest";
import { fileExtension } from "./file-type";
it("preserves QuickTime, WebM, MP3 and WAV container types when opening saved media", () => {
  for (const [mime, ext] of [["video/quicktime", "mov"], ["video/webm", "webm"], ["audio/mpeg", "mp3"], ["audio/wav", "wav"], ["audio/ogg", "ogg"], ["image/webp", "webp"]])
    expect(fileExtension(mime)).toBe(ext);
});

it("preserves common iPhone containers and normalizes MIME parameters",()=>{
  for(const [mime,ext] of [["image/heic","heic"],["image/heif","heif"],["audio/x-m4a","m4a"],["audio/aac","aac"],["video/3gpp","3gp"],["video/x-m4v","m4v"],[" IMAGE/HEIC ; codecs=hevc","heic"]]) expect(fileExtension(mime)).toBe(ext);
});

import { supportedFileMime } from "./file-type";
it("recognizes missing native MIME conservatively without overriding a known unsupported type", () => {
  expect(supportedFileMime(undefined, "photo.HEIC")).toBe("image/heic");
  expect(supportedFileMime("application/octet-stream", "recording.m4a")).toBe("audio/mp4");
  expect(supportedFileMime(" Image/PNG; charset=binary ")).toBe("image/png");
  expect(supportedFileMime("application/zip", "fake.jpg")).toBeNull();
  expect(supportedFileMime(undefined, "unknown")).toBeNull();
});
