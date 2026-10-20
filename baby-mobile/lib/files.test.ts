import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BabyApi } from "./api";

const native = vi.hoisted(() => ({ size: 3, copy: vi.fn(), remove: vi.fn(), bytes: vi.fn(async () => new Uint8Array([65, 66, 67])) }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///private/", makeDirectoryAsync: vi.fn(), copyAsync: native.copy, deleteAsync: native.remove }));
vi.mock("expo-file-system", () => ({
  File: class {
    get size() { return native.size; }
    bytes = native.bytes;
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "copy-id" }));
vi.mock("expo-sharing", () => ({}));
import { preserveFile, uploadFile } from "./files";

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
