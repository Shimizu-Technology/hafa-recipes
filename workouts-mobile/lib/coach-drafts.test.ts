import { it, expect } from "vitest";
import { createCoachDraftStore } from "./coach-drafts";
import { draftKey } from "./drafts";
import { draftKey } from "./drafts";
it("clears all conversation focuses for only this owner/generation and fences delayed saves from the old reset epoch", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: async (k: string) => values.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: async (k: string) => {
      values.delete(k);
    },
    getAllKeys: async () => [...values.keys()],
  };
  const store = createCoachDraftStore(storage);
  await store.save("owner", 2, "workout", { message: "private old message", pending: null }, "initial");
  await store.save("owner", 2, "plan", { message: "private old plan message", pending: null }, "initial");
  await store.save("other", 2, "plan", { message: "other message", pending: null }, "initial");
  await store.save("owner", 3, "plan", { message: "other enrollment", pending: null }, "initial");
  await store.clear("owner", 2, "reset");
  expect(await store.save("owner", 2, "workout", { message: "late callback", pending: null }, "initial")).toBe(false);
  expect((await store.load("owner", 2, "plan")).value).toBeNull();
  expect(values.has(draftKey("other", "coach-draft:2:plan"))).toBe(true);
  expect(values.has(draftKey("owner", "coach-draft:3:plan"))).toBe(true);
  expect(await store.save("owner", 2, "plan", { message: "new explicit message", pending: null }, "reset")).toBe(true);
});
it("restores exact pending cancellation intent without changing the request identity or focus", async () => {
  const values = new Map<string, string>();
  const storage = { getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); }, getAllKeys: async () => [...values.keys()] };
  const pending = { request_id: "same-request", message: "Private question", generation: 2,
    focus: { context_workout_id: "workout", context_revision: 7 }, created_at: "2026-10-15T00:00:00Z", stop_requested: true as const };
  expect(await createCoachDraftStore(storage).save("owner", 2, "workout", { message: pending.message, pending }, "initial")).toBe(true);
  expect((await createCoachDraftStore(storage).load("owner", 2, "workout")).value?.pending).toEqual(pending);
  expect((await createCoachDraftStore(storage).load("other", 2, "workout")).value).toBeNull();
});


import { createCoachPhotoStore } from "./coach-photos";
const photoUuid = "00000000-0000-4000-8000-000000000001", attachmentUuid = "00000000-0000-4000-8000-000000000002";
const selectedPhoto = { upload_id: photoUuid, file: { uri: "file:///cache/hafa-workouts-capture/photo.jpg", mime_type: "image/jpeg", name: "Coach photo", owned: true } };
function photoFixture() {
  const values = new Map<string, string>();
  const storage = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); }, getAllKeys: async () => [...values.keys()] };
  const api = { uploadCoachImage: vi.fn().mockResolvedValue({ id: attachmentUuid, expires_at: "2099-01-01T00:00:00Z" }), discardCoachImage: vi.fn().mockResolvedValue(undefined) };
  const cleanup = vi.fn().mockResolvedValue(undefined);
  const store = createCoachPhotoStore(storage, "owner", 1, "general", api, cleanup);
  return { store, values, storage, api, cleanup };
}
it("persists photo identity before upload, stores no bytes or signed URL, then hands off without deleting chat media", async () => {
  const f = photoFixture(); await f.store.select(selectedPhoto, () => undefined);
  f.api.uploadCoachImage.mockImplementationOnce(async () => {
    expect((await f.store.load())?.upload_id).toBe(photoUuid);
    return { id: attachmentUuid, expires_at: "2099-01-01T00:00:00Z" };
  });
  const ready = await f.store.upload(selectedPhoto, { base64_data: "PRIVATE IMAGE BYTES", content_type: "image/jpeg" }, () => undefined);
  expect(ready).toEqual({ upload_id: photoUuid, attachment_id: attachmentUuid, expires_at: "2099-01-01T00:00:00Z" });
  expect(JSON.stringify([...f.values.values()])).not.toContain("PRIVATE IMAGE BYTES");
  expect(f.cleanup).toHaveBeenCalledWith([selectedPhoto.file]);
  await f.store.handoff(attachmentUuid, () => undefined);
  expect(await f.store.load()).toBeNull(); expect(f.api.discardCoachImage).not.toHaveBeenCalled();
});
it("keeps the same upload UUID and exact file after a lost acknowledgment", async () => {
  const f = photoFixture(); await f.store.select(selectedPhoto, () => undefined);
  f.api.uploadCoachImage.mockRejectedValueOnce(Error("Lost upload acknowledgement"));
  const body = { base64_data: "bytes", content_type: "image/jpeg" };
  await expect(f.store.upload(selectedPhoto, body, () => undefined)).rejects.toThrow("Lost upload");
  expect(await f.store.load()).toEqual(selectedPhoto);
  await f.store.upload((await f.store.load())!, body, () => undefined);
  expect(f.api.uploadCoachImage.mock.calls.map(call => call.slice(0, 3))).toEqual([[photoUuid, body, 1], [photoUuid, body, 1]]);
});
it("a concurrent remove tombstones original upload identity and a late upload acknowledgment cannot resurrect it", async () => {
  const f = photoFixture(); await f.store.select(selectedPhoto, () => undefined);
  let finish!: (value: { id: string; expires_at: string }) => void;
  f.api.uploadCoachImage.mockImplementationOnce(() => new Promise(done => { finish = done; }));
  const pending = f.store.upload(selectedPhoto, { base64_data: "bytes", content_type: "image/jpeg" }, () => undefined);
  while (!finish) await Promise.resolve();
  await f.store.discard(selectedPhoto, () => undefined);
  finish({ id: attachmentUuid, expires_at: "2099-01-01T00:00:00Z" });
  expect(await pending).toBeNull(); expect(await f.store.load()).toBeNull();
  expect(f.api.discardCoachImage).toHaveBeenCalledWith(photoUuid, 1);
});
it("failed privacy deletion survives remount, blocks upload, and retries the same deletion identity", async () => {
  const f = photoFixture(); await f.store.select(selectedPhoto, () => undefined);
  f.api.discardCoachImage.mockRejectedValueOnce(Error("Offline"));
  await expect(f.store.discard(selectedPhoto, () => undefined)).rejects.toThrow("Offline");
  const restored = createCoachPhotoStore(f.storage, "owner", 1, "general", f.api, f.cleanup);
  expect((await restored.load())?.discard).toBe(true);
  await expect(restored.upload(selectedPhoto, { base64_data: "bytes", content_type: "image/jpeg" }, () => undefined)).rejects.toThrow("removed");
  expect(f.api.uploadCoachImage).not.toHaveBeenCalled();
  await restored.discard((await restored.load())!, () => undefined);
  expect(f.api.discardCoachImage.mock.calls).toEqual([[photoUuid, 1], [photoUuid, 1]]);
});
it("conversation photo cleanup covers all own focuses while preserving other owners and generations", async () => {
  const f = photoFixture(); await f.store.select(selectedPhoto, () => undefined);
  const stores = [["owner", 1, "workout"], ["other", 1, "general"], ["owner", 2, "general"]] as const;
  for (const [owner, generation, focus] of stores) await createCoachPhotoStore(f.storage, owner, generation, focus, f.api, f.cleanup).select(selectedPhoto, () => undefined);
  await f.store.clearAll(() => undefined);
  expect(f.api.discardCoachImage).toHaveBeenCalledTimes(2);
  expect([...f.values.keys()]).toHaveLength(2);
  expect([...f.values.keys()].every(key => key.includes("other") || key.includes("photo%3A2%3A"))).toBe(true);
});


it("confirmed server Clear removes malformed own-generation photo metadata and sweeps only exact native cleanup debt", async () => {
  const f = photoFixture(), own = draftKey("owner", "coach-photo:1:");
  f.values.set(own + "broken", '{not-json'); f.values.set(own + "invalid", JSON.stringify({ upload_id: "invalid", file: { uri: "file:///foreign/private.jpg" } }));
  f.values.set(draftKey("other", "coach-photo:1:") + "general", "foreign");
  f.values.set(draftKey("owner", "coach-photo:2:") + "general", "other generation");
  const recover = vi.fn(async () => { expect([...f.values.keys()].some(key => key.startsWith(own))).toBe(false); });
  await f.store.clearAfterConfirmedServerClear(() => {}, recover);
  expect(f.cleanup).not.toHaveBeenCalled(); expect(f.api.discardCoachImage).not.toHaveBeenCalled();
  expect(recover).toHaveBeenCalledOnce(); expect([...f.values.values()]).toEqual(["foreign", "other generation"]);
});
it.each(["owner", "epoch"])("confirmed photo cleanup rejects retired %s authority before changing metadata", async reason => {
  const f = photoFixture(), key = draftKey("owner", "coach-photo:1:") + "broken"; f.values.set(key, 'broken');
  const recover = vi.fn();
  await expect(f.store.clearAfterConfirmedServerClear(() => { throw Error(`${reason} retired`); }, recover)).rejects.toThrow(`${reason} retired`);
  expect(f.values.get(key)).toBe('broken'); expect(recover).not.toHaveBeenCalled();
});
it("confirmed photo cleanup preserves fail-closed native recovery and allows retry without forgetting that debt", async () => {
  const f = photoFixture(), key = draftKey("owner", "coach-photo:1:") + "broken"; f.values.set(key, 'broken');
  const nativeDebt = "opaque native journal retained", recover = vi.fn().mockRejectedValueOnce(Error(nativeDebt)).mockResolvedValueOnce(undefined);
  await expect(f.store.clearAfterConfirmedServerClear(() => {}, recover)).rejects.toThrow(nativeDebt);
  expect(f.values.has(key)).toBe(false); await f.store.clearAfterConfirmedServerClear(() => {}, recover);
  expect(recover).toHaveBeenCalledTimes(2);
});
