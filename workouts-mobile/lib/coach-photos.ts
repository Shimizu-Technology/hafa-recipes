import { draftKey, type Storage } from "./drafts";
import type { CaptureFile } from "./capture";
export interface CoachPhoto {
  upload_id: string;
  file?: CaptureFile;
  attachment_id?: string;
  expires_at?: string;
  discard?: boolean;
}
export interface CoachPhotoApi {
  uploadCoachImage(uploadId: string, body: { base64_data: string; content_type: string }, generation: number, signal?: AbortSignal): Promise<{ id: string; expires_at: string }>;
  discardCoachImage(uploadId: string, generation: number): Promise<void>;
}
const operations = new Map<string, Promise<unknown>>();
function ordered<T>(key: string, work: () => Promise<T>) {
  const next = (operations.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
  operations.set(key, next);
  void next.finally(() => { if (operations.get(key) === next) operations.delete(key); }).catch(() => undefined);
  return next;
}
/** Persist upload UUID before transport; uncertain deletion keeps the same privacy command. */
export function createCoachPhotoStore(storage: Storage & { getAllKeys(): Promise<readonly string[]> }, owner: string, generation: number,
  focus: string, api: CoachPhotoApi, cleanup: (files: CaptureFile[]) => Promise<void>) {
  const prefix = draftKey(owner, `coach-photo:${generation}:`), key = prefix + encodeURIComponent(focus);
  const read = async (at = key): Promise<CoachPhoto | null> => {
    const raw = await storage.getItem(at);
    if (!raw) return null;
    const value = JSON.parse(raw) as CoachPhoto;
    if (!value || typeof value.upload_id !== "string" || !/^[0-9a-f-]{36}$/i.test(value.upload_id))
      throw Error("Could not restore this photo. Clear the conversation to remove its private uploads.");
    return value;
  };
  const save = (photo: CoachPhoto, at = key) => storage.setItem(at, JSON.stringify(photo));
  async function discard(photo: CoachPhoto, current: () => void, at = key) {
    const admitted = await ordered(at, async () => {
      current(); if ((await read(at))?.upload_id !== photo.upload_id) return false;
      await save({ ...photo, discard: true }, at); return true;
    });
    if (!admitted) return;
    // Exact local cleanup is safe even if its old view retires. The authenticated
    // deletion still requires the original current owner/generation.
    const local = cleanup(photo.file ? [photo.file] : []);
    const remote = (async () => { current(); await api.discardCoachImage(photo.upload_id, generation); current(); })();
    const results = await Promise.allSettled([local, remote]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
    await ordered(at, async () => { current(); if ((await read(at))?.upload_id === photo.upload_id) await storage.removeItem(at); });
  }
  return {
    load: () => ordered(key, () => read()),
    async select(photo: CoachPhoto, current: () => void) {
      await ordered(key, async () => {
        current(); if (await read()) throw Error("Remove the current photo before choosing another.");
        await save(photo); current();
      });
    },
    async upload(photo: CoachPhoto, body: { base64_data: string; content_type: string }, current: () => void, signal?: AbortSignal) {
      const admitted = await ordered(key, async () => { current(); const stored = await read(); return stored?.upload_id === photo.upload_id && !stored.discard; });
      if (!admitted) throw Error("This photo was removed; it will not be uploaded again.");
      current();
      if (signal?.aborted) throw Error("This photo upload was retired.");
      const receipt = await api.uploadCoachImage(photo.upload_id, body, generation, signal);
      current();
      if (!/^[0-9a-f-]{36}$/i.test(receipt.id) || !Number.isFinite(Date.parse(receipt.expires_at)))
        throw Error("Could not confirm this photo upload. Retry the same photo or remove it.");
      return ordered(key, async () => {
        current(); const stored = await read();
        if (stored?.upload_id !== photo.upload_id || stored.discard) return null;
        const ready = { upload_id: photo.upload_id, attachment_id: receipt.id, expires_at: receipt.expires_at };
        await save({ ...ready, ...(photo.file ? { file: photo.file } : {}) }); current();
        await cleanup(photo.file ? [photo.file] : []); current(); await save(ready); return ready;
      });
    },
    discard,
    async handoff(attachmentId: string | undefined, current: () => void) {
      if (!attachmentId) return;
      await ordered(key, async () => {
        current(); const photo = await read();
        if (photo?.attachment_id !== attachmentId) return;
        await cleanup(photo.file ? [photo.file] : []); current(); await storage.removeItem(key);
      });
    },
    async clearAfterConfirmedServerClear(current: () => void, recover: () => Promise<void>) {
      current();
      for (const at of await storage.getAllKeys()) {
        if (!at.startsWith(prefix)) continue;
        await ordered(at, async () => { current(); await storage.removeItem(at); current(); });
      }
      // Server Clear already tombstoned every private upload. Never interpret a
      // corrupted file URI; native cleanup retains its own exact, guarded debt.
      current(); await recover(); current();
    },
    async clearAll(current: () => void) {
      for (const at of await storage.getAllKeys()) {
        if (!at.startsWith(prefix)) continue;
        current(); const photo = await ordered(at, () => read(at));
        if (photo) await discard(photo, current, at);
      }
    },
  };
}
