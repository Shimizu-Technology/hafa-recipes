import AsyncStorage from '@react-native-async-storage/async-storage';

import { pendingChatImageCleanupKey } from './chatStorage';

export interface ChatImageCleanupJob {
  id: string;
  imageUrls: string[];
  state: 'prepared' | 'ready';
}

type DeleteImages = (imageUrls: string[]) => Promise<unknown>;

const mutationTails = new Map<string, Promise<void>>();
const activeProcessors = new Map<string, Promise<void>>();

function validJob(value: unknown): value is ChatImageCleanupJob {
  return Boolean(
    value
    && typeof value === 'object'
    && 'id' in value
    && typeof value.id === 'string'
    && value.id.length > 0
    && 'imageUrls' in value
    && Array.isArray(value.imageUrls)
    && value.imageUrls.length > 0
    && value.imageUrls.every((url) => typeof url === 'string' && url.startsWith('https://'))
    && 'state' in value
    && (value.state === 'prepared' || value.state === 'ready'),
  );
}

async function readQueue(cleanupKey: string): Promise<ChatImageCleanupJob[]> {
  const stored = await AsyncStorage.getItem(cleanupKey);
  if (!stored) return [];
  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed) || !parsed.every(validJob)) {
    throw new Error('The pending chat image cleanup queue is invalid');
  }
  return parsed;
}

async function writeQueue(cleanupKey: string, jobs: ChatImageCleanupJob[]): Promise<void> {
  if (jobs.length === 0) {
    await AsyncStorage.removeItem(cleanupKey);
  } else {
    await AsyncStorage.setItem(cleanupKey, JSON.stringify(jobs));
  }
}

/** Serialize read-modify-write operations for one conversation cleanup queue. */
async function mutateQueue<T>(cleanupKey: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationTails.get(cleanupKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  mutationTails.set(cleanupKey, current);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (mutationTails.get(cleanupKey) === current) mutationTails.delete(cleanupKey);
  }
}

/** Append one independently identifiable cleanup job before local history is removed. */
export async function enqueueChatImageCleanup(
  conversationKey: string,
  job: Omit<ChatImageCleanupJob, 'state'>,
): Promise<void> {
  const cleanupKey = pendingChatImageCleanupKey(conversationKey);
  await mutateQueue(cleanupKey, async () => {
    const jobs = await readQueue(cleanupKey);
    if (jobs.some((existing) => existing.id === job.id)) return;
    await writeQueue(cleanupKey, [...jobs, { ...job, state: 'prepared' }]);
  });
}

/** Make one prepared job eligible only after its local history removal commits. */
export async function activateChatImageCleanup(
  conversationKey: string,
  jobId: string,
): Promise<void> {
  const cleanupKey = pendingChatImageCleanupKey(conversationKey);
  await mutateQueue(cleanupKey, async () => {
    const jobs = await readQueue(cleanupKey);
    if (!jobs.some((job) => job.id === jobId)) {
      throw new Error('The prepared chat image cleanup job is missing');
    }
    await writeQueue(cleanupKey, jobs.map((job) => (
      job.id === jobId ? { ...job, state: 'ready' as const } : job
    )));
  });
}

/** Recover a crash between queue preparation and local history removal. */
export async function recoverChatImageCleanup(
  conversationKey: string,
  conversationExists: boolean,
): Promise<void> {
  const cleanupKey = pendingChatImageCleanupKey(conversationKey);
  await mutateQueue(cleanupKey, async () => {
    const jobs = await readQueue(cleanupKey);
    const recovered = conversationExists
      ? jobs.filter((job) => job.state === 'ready')
      : jobs.map((job) => ({ ...job, state: 'ready' as const }));
    await writeQueue(cleanupKey, recovered);
  });
}

/** Remove only the named job, preserving newer or concurrent cleanup work. */
export async function removeChatImageCleanup(
  conversationKey: string,
  jobId: string,
): Promise<void> {
  const cleanupKey = pendingChatImageCleanupKey(conversationKey);
  await mutateQueue(cleanupKey, async () => {
    const jobs = await readQueue(cleanupKey);
    await writeQueue(cleanupKey, jobs.filter((job) => job.id !== jobId));
  });
}

/** Return whether one exact job is still waiting without exposing queue storage details. */
export async function hasChatImageCleanup(
  conversationKey: string,
  jobId: string,
): Promise<boolean> {
  const cleanupKey = pendingChatImageCleanupKey(conversationKey);
  return mutateQueue(
    cleanupKey,
    async () => (await readQueue(cleanupKey)).some((job) => job.id === jobId),
  );
}

/** Process a conversation queue once, retaining each failed job for a later retry. */
export function processChatImageCleanup(
  conversationKey: string,
  deleteImages: DeleteImages,
): Promise<void> {
  const existing = activeProcessors.get(conversationKey);
  if (existing) {
    return existing.then(() => processChatImageCleanup(conversationKey, deleteImages));
  }

  const cleanupKey = pendingChatImageCleanupKey(conversationKey);
  const processor = (async () => {
    while (true) {
      let job: ChatImageCleanupJob | undefined;
      try {
        job = await mutateQueue(
          cleanupKey,
          async () => (await readQueue(cleanupKey)).find((queued) => queued.state === 'ready'),
        );
      } catch {
        return;
      }
      if (!job) return;

      try {
        await deleteImages(job.imageUrls);
        await removeChatImageCleanup(conversationKey, job.id);
      } catch {
        return;
      }
    }
  })().finally(() => {
    if (activeProcessors.get(conversationKey) === processor) {
      activeProcessors.delete(conversationKey);
    }
  });
  activeProcessors.set(conversationKey, processor);
  return processor;
}

/** Reset module coordination state between isolated test cases. */
export function resetChatImageCleanupForTests(): void {
  mutationTails.clear();
  activeProcessors.clear();
}
