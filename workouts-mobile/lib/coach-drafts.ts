import { draftKey, type Storage } from "./drafts";
import type { PendingCoachMessage } from "./coach";
interface CoachDraft {
  message: string;
  pending: PendingCoachMessage | null;
  epoch?: string;
}
export function createCoachDraftStore(storage: Storage & { getAllKeys(): Promise<readonly string[]> }) {
  const operations = new Map<string, Promise<unknown>>();
  const group = (owner: string, generation: number) => draftKey(owner, `coach-reset:${generation}`);
  function ordered<T>(key: string, work: () => Promise<T>) {
    const promise = (operations.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    operations.set(key, promise);
    return promise;
  }
  const epoch = async (owner: string, generation: number) =>
    (await storage.getItem(group(owner, generation))) ?? "initial";
  return {
    epoch,
    load(owner: string, generation: number, focus: string) {
      return ordered(group(owner, generation), async () => {
        const current = await epoch(owner, generation);
        const key = draftKey(owner, `coach-draft:${generation}:${focus}`);
        const raw = await storage.getItem(key);
        const value = raw ? (JSON.parse(raw) as CoachDraft) : null;
        return { epoch: current, value: value && (value.epoch ?? "initial") === current ? value : null };
      });
    },
    save(owner: string, generation: number, focus: string, value: CoachDraft, expectedEpoch: string) {
      return ordered(group(owner, generation), async () => {
        if ((await epoch(owner, generation)) !== expectedEpoch) return false;
        await storage.setItem(
          draftKey(owner, `coach-draft:${generation}:${focus}`),
          JSON.stringify({ ...value, epoch: expectedEpoch })
        );
        return true;
      });
    },
    clear(owner: string, generation: number, nextEpoch: string) {
      return ordered(group(owner, generation), async () => {
        await storage.setItem(group(owner, generation), nextEpoch);
        const prefix = `hafa-workouts:v1:${encodeURIComponent(owner)}:coach-draft%3A${generation}%3A`;
        for (const key of await storage.getAllKeys()) if (key.startsWith(prefix)) await storage.removeItem(key);
      });
    },
  };
}
