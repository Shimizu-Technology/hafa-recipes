import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BabyApi } from "./api";

const native = vi.hoisted(() => ({ size: 3, copy: vi.fn(), remove: vi.fn(), move: vi.fn(), print: vi.fn(), share: vi.fn(), bytes: vi.fn(async () => new Uint8Array([65, 66, 67])) }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///private/", makeDirectoryAsync: vi.fn(), copyAsync: native.copy, deleteAsync: native.remove, moveAsync: native.move }));
vi.mock("expo-file-system", () => ({
  File: class {
    get size() { return native.size; }
    bytes = native.bytes;
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "copy-id" }));
vi.mock("expo-sharing", () => ({ shareAsync: native.share }));
vi.mock("expo-print", () => ({ printToFileAsync: native.print }));
import { exportOnePagePdf, preserveFile, uploadFile } from "./files";

describe("sharing a one-page PDF", () => {
  beforeEach(() => { native.print.mockReset(); native.move.mockReset(); native.remove.mockReset().mockResolvedValue(undefined); native.share.mockReset().mockResolvedValue(undefined); });
  it("gives up detail, level by level, until the page fits, and shares only that one", async () => {
    native.print.mockResolvedValueOnce({ uri: "file:///cache/a.pdf", numberOfPages: 2 }).mockResolvedValueOnce({ uri: "file:///cache/b.pdf", numberOfPages: 1 });
    const html = vi.fn((level: number) => `level ${level}`);
    await expect(exportOnePagePdf(html, 3, "owner", "s.pdf")).resolves.toEqual({ level: 1, fits: true });
    expect(html.mock.calls.map(([level]) => level)).toEqual([0, 1]);
    expect(native.share).toHaveBeenCalledTimes(1);
    expect(native.share.mock.calls[0][1]).toEqual({ mimeType: "application/pdf", UTI: "com.adobe.pdf" });
    expect(native.print.mock.calls[0][0]).toMatchObject({ width: 612, height: 792 });
  });
  it("shares nothing when even the last level runs over, and keeps none of the tries", async () => {
    native.print.mockResolvedValueOnce({ uri: "file:///cache/a.pdf", numberOfPages: 2 }).mockResolvedValueOnce({ uri: "file:///cache/b.pdf", numberOfPages: 2 });
    await expect(exportOnePagePdf(() => "x", 1, "owner", "s.pdf")).resolves.toEqual({ level: 1, fits: false });
    expect(native.share).not.toHaveBeenCalled();
    expect(native.move).not.toHaveBeenCalled();
    for (const uri of ["file:///cache/a.pdf", "file:///cache/b.pdf"]) expect(native.remove).toHaveBeenCalledWith(uri, { idempotent: true });
  });
  it("leaves nothing in the print cache when the move fails", async () => {
    native.print.mockResolvedValue({ uri: "file:///cache/a.pdf", numberOfPages: 1 });
    native.move.mockRejectedValue(Error("disk full"));
    await expect(exportOnePagePdf(() => "x", 0, "owner", "s.pdf")).rejects.toThrow("disk full");
    expect(native.remove).toHaveBeenCalledWith("file:///cache/a.pdf", { idempotent: true });
    expect(native.remove.mock.calls.some(([uri]) => String(uri).endsWith("s.pdf"))).toBe(true);
    expect(native.share).not.toHaveBeenCalled();
  });
  it("still clears the rest, and reports the real failure, when one delete fails", async () => {
    native.print.mockResolvedValue({ uri: "file:///cache/a.pdf", numberOfPages: 1 });
    native.share.mockRejectedValue(Error("cancelled"));
    native.remove.mockImplementation(async (uri: string) => { if (uri.endsWith("a.pdf")) throw Error("locked"); });
    await expect(exportOnePagePdf(() => "x", 0, "owner", "s.pdf")).rejects.toThrow("cancelled");
    expect(native.remove.mock.calls.some(([uri]) => String(uri).endsWith("s.pdf"))).toBe(true);
  });
  it("keeps no private copy, even when sharing fails", async () => {
    native.print.mockResolvedValue({ uri: "file:///cache/a.pdf", numberOfPages: 1 });
    native.share.mockRejectedValue(Error("cancelled"));
    await expect(exportOnePagePdf(() => "x", 0, "owner", "s.pdf")).rejects.toThrow("cancelled");
    expect(native.remove.mock.calls.at(-1)![0]).toContain("s.pdf");
  });
});

describe("private native upload compatibility", () => {
  beforeEach(() => {
    native.size = 3;
    native.bytes.mockClear(); native.copy.mockReset(); native.remove.mockReset().mockResolvedValue(undefined);
    // Native Expo FormData retains File values for its bytes()-based multipart encoder.
    vi.stubGlobal("FormData", class {
      private parts = new Map<string, unknown>();
      append(name: string, value: unknown) { this.parts.set(name, value); }
      get(name: string) { return this.parts.get(name); }
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends actual multipart bytes with the original filename, MIME and stable retry identity", async () => {
    const upload = vi.fn(async () => ({ id: "server-file" }));
    const api = { upload } as unknown as BabyApi;
    const file = { id: "stable-id", uri: "file:///private/photo", name: "baby-photo.png", mime_type: "image/png" };
    await uploadFile(api, file, 4);
    const [body, generation, id] = upload.mock.calls[0] as unknown as [FormData, number, string];
    const part = body.get("file") as unknown as { name: string; type: string; bytes(): Promise<Uint8Array> };
    expect(part.name).toBe(file.name);
    expect(part.type).toBe("image/png");
    expect(await part.bytes()).toEqual(new Uint8Array([65, 66, 67]));
    expect([generation, id]).toEqual([4, "stable-id"]);
  });

  it("rejects an oversized native original before loading its bytes or sending a request", async () => {
    native.size = 25 * 1024 * 1024 + 1;
    const upload = vi.fn();
    await expect(uploadFile({ upload } as unknown as BabyApi,
      { id: "id", uri: "file:///private/video", name: "video.mp4", mime_type: "video/mp4" }, 1)
    ).rejects.toThrow("smaller than 25 MB");
    expect(native.bytes).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });


  it("preflights actual size even when a share omits size metadata", async () => {
    native.size = 25 * 1024 * 1024 + 1;
    await expect(preserveFile("local-parent", { uri: "file:///shared/video.mp4", mimeType: "video/mp4" }))
      .rejects.toMatchObject({ code: "file_too_large" });
    expect(native.copy).not.toHaveBeenCalled();
  });
  it("infers a supported missing MIME and removes a partially failed private copy", async () => {
    native.size = 123; native.copy.mockRejectedValueOnce(Error("Interrupted copy"));
    await expect(preserveFile("local-parent", { uri: "file:///shared/photo.heic", name: "photo.heic" }))
      .rejects.toThrow("Interrupted copy");
    expect(native.remove).toHaveBeenCalledWith(expect.stringContaining("copy-id-photo.heic"), { idempotent: true });
  });
});
