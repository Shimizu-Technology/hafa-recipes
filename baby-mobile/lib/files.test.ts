import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BabyApi } from "./api";

const native = vi.hoisted(() => ({ size: 3, bytes: vi.fn(async () => new Uint8Array([65, 66, 67])) }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-file-system/legacy", () => ({}));
vi.mock("expo-file-system", () => ({
  File: class {
    get size() { return native.size; }
    bytes = native.bytes;
  },
}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-sharing", () => ({}));
import { uploadFile } from "./files";

describe("private native upload compatibility", () => {
  beforeEach(() => {
    native.size = 3;
    native.bytes.mockClear();
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
});
