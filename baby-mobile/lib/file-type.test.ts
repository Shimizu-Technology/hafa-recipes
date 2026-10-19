import { expect, it } from "vitest";
import { fileExtension } from "./file-type";
it("preserves QuickTime, WebM, MP3 and WAV container types when opening saved media", () => {
  for (const [mime, ext] of [["video/quicktime", "mov"], ["video/webm", "webm"], ["audio/mpeg", "mp3"], ["audio/wav", "wav"], ["audio/ogg", "ogg"], ["image/webp", "webp"]])
    expect(fileExtension(mime)).toBe(ext);
});
