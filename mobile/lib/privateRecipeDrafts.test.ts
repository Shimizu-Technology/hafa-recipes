import { IMPORT_INBOX_STORAGE_KEY } from './importInboxStorage';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
const media = vi.hoisted(() => ({ files: new Set<string>(), copied: false }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'copy' }));
vi.mock('expo-file-system', () => ({
  Paths: { document: 'file:///private' },
  Directory: class {
    uri: string;
    constructor(...parts: string[]) { this.uri = parts.join('/') + '/'; }
    get exists() { return [...media.files].some(path => path.startsWith(this.uri)); }
    create() {}
    delete() { for (const path of media.files) if (path.startsWith(this.uri)) media.files.delete(path); }
  },
  File: class {
    uri: string;
    constructor(root: string | { uri: string }, name?: string) { this.uri = typeof root === 'string' ? root : root.uri + name; }
    get exists() { return media.files.has(this.uri); }
    copy(file: { uri: string }) { media.files.add(file.uri); media.copied = true; }
    delete() { media.files.delete(this.uri); }
  },
}));
import { createPrivateRecipeDrafts } from './privateRecipeDrafts';
function fixture() {
  const data = new Map<string, string>();
  const storage = { getItem: vi.fn(async (key: string) => data.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { data.delete(key); }),
    getAllKeys: vi.fn(async () => [...data.keys()]), multiRemove: vi.fn(async (keys: string[]) => keys.forEach(key => data.delete(key))) };
  return { drafts: createPrivateRecipeDrafts(storage as any), storage, data };
}
describe('private recipe drafts', () => {
  it('survives a new store, isolates stable owners and methods, and serializes discard', async () => {
    const { drafts, storage } = fixture(); const owner = drafts.lease('stable-a');
    await drafts.write(owner, 'manual', { title: 'Rice', components: [{ name: 'Sauce', notes: 'Family note' }] });
    expect(await drafts.read(drafts.lease('stable-b'), 'manual')).toBeNull();
    expect(await drafts.read(owner, 'paste')).toBeNull();
    const relaunched = createPrivateRecipeDrafts(storage as any);
    expect(await relaunched.read(relaunched.lease('stable-a'), 'manual')).toMatchObject({ title: 'Rice' });
    const pending = drafts.write(owner, 'manual', { title: 'New title' });
    const discard = drafts.remove(owner, 'manual');
    await Promise.all([pending, discard]);
    expect(await drafts.read(owner, 'manual')).toBeNull();
  });
  it('invalidates pending writes on sign-out and never deletes unrelated storage', async () => {
    const { drafts, data } = fixture(); const owner = drafts.lease('stable-a');
    data.set('unrelated', 'keep');
    const stale = drafts.write(owner, 'scan', { selectedImages: [] });
    const clear = drafts.clearAll();
    await expect(stale).rejects.toThrow('Account changed'); await clear;
    await expect(drafts.write(owner, 'manual', {})).rejects.toThrow('Account changed');
    expect(data.get('unrelated')).toBe('keep');
    expect(await drafts.read(drafts.lease('stable-b'), 'scan')).toBeNull();
  });
  it('reports disk failure and refuses unbounded content', async () => {
    const { drafts, storage } = fixture();
    storage.setItem.mockRejectedValueOnce(new Error('Disk full'));
    await expect(drafts.write(drafts.lease('a'), 'paste', { text: 'Rice' })).rejects.toThrow('Disk full');
    await expect(drafts.write(drafts.lease('a'), 'paste', { text: 'x'.repeat(500_001) })).rejects.toThrow('too large');
  });
});

it('rejects an old picker lease before media copy after sign-out deletion', async () => {
  const { drafts } = fixture(); const lease = drafts.lease('stable-a');
  await drafts.clearAll();
  await expect(drafts.preserveImage(lease, 'file:///private-old.jpg', () => {})).rejects.toThrow('Account changed');
});

it('removes the exact new media copy if its continuation becomes abandoned', async () => {
  const { drafts } = fixture(); media.files.clear(); media.copied = false;
  media.files.add('file:///unrelated.jpg');
  await expect(drafts.preserveImage(drafts.lease('a'), 'file:///source.jpg', () => {
    if (media.copied) throw new Error('unmounted');
  })).rejects.toThrow('unmounted');
  expect([...media.files]).toEqual(['file:///unrelated.jpg']);
});

it('never deletes a page while another draft or pending capture still references it', async () => {
  const { drafts, data } = fixture(); const lease = drafts.lease('owner-a');
  const uri = 'file:///private/private-recipe-drafts/owner-a/page.jpg'; media.files.add(uri);
  await drafts.write(lease, 'scan', { selectedImages: [{ uri }] });
  await drafts.write(lease, 'recovery', { request: { original_pages: [{ uri }] } });
  await drafts.remove(lease, 'scan');
  expect(media.files.has(uri)).toBe(true);
  data.set(IMPORT_INBOX_STORAGE_KEY, JSON.stringify([{ state: 'waiting', capture: { kind: 'images', images: [{ uri }] } }]));
  await drafts.remove(lease, 'recovery');
  expect(media.files.has(uri)).toBe(true);
  await drafts.write(lease, 'recovery', { request: { original_pages: [{ uri }] } });
  data.delete(IMPORT_INBOX_STORAGE_KEY);
  await drafts.remove(lease, 'recovery');
  expect(media.files.has(uri)).toBe(false);
});

it('protects a queued retry reference registered after cleanup starts', async () => {
  const { drafts, storage, data } = fixture(); const lease = drafts.lease('owner-a');
  const uri = 'file:///private/private-recipe-drafts/owner-a/racing-page.jpg'; media.files.add(uri);
  await drafts.write(lease, 'scan', { selectedImages: [{ uri }] });
  let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  storage.getAllKeys.mockImplementationOnce(async () => {
    entered(); await new Promise<void>(resolve => { release = resolve; }); return [...data.keys()];
  });
  const removal = drafts.remove(lease, 'scan'); await started;
  const retry = drafts.write(lease, 'recovery', { request: { original_pages: [{ uri }] } });
  release(); await Promise.all([removal, retry]);
  expect(media.files.has(uri)).toBe(true);
  expect(await drafts.read(lease, 'recovery')).not.toBeNull();
  await drafts.remove(lease, 'recovery'); expect(media.files.has(uri)).toBe(false);
});


it('blocks a different scan or recovery while A is unresolved, permits A retry and fences stale removal', async () => {
  const { drafts } = fixture(); const lease = drafts.lease('owner-a');
  const a = { captureId: 'a', request: { original_pages: [{ uri: 'a.jpg' }] } };
  await drafts.write(lease, 'scan', { selectedImages: [{ uri: 'a.jpg' }] });
  await drafts.write(lease, 'recovery', a);
  await expect(drafts.write(lease, 'scan', { selectedImages: [{ uri: 'b.jpg' }] })).rejects.toThrow('Finish or discard');
  await expect(drafts.write(lease, 'recovery', { captureId: 'b' })).rejects.toThrow('Finish or discard');
  await drafts.write(lease, 'recovery', { ...a, retry: true });
  await drafts.remove(lease, 'recovery', a);
  expect(await drafts.read(lease, 'recovery')).toMatchObject({ captureId: 'a', retry: true });
  const retry = await drafts.read(lease, 'recovery');
  await drafts.remove(lease, 'recovery', retry);
  expect(await drafts.read(lease, 'scan')).toBeNull();
  await drafts.write(lease, 'recovery', { captureId: 'b' });
  await drafts.remove(lease, 'recovery', retry);
  expect(await drafts.read(lease, 'recovery')).toMatchObject({ captureId: 'b' });
});
