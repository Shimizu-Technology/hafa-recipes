import { beforeEach, describe, expect, it, vi } from 'vitest';

const drafts = vi.hoisted(() => ({ write: vi.fn(async (): Promise<void> => undefined), remove: vi.fn(async () => undefined), lease: (owner: string) => ({ owner, epoch: 0 }) }));
vi.mock('./privateRecipeDrafts', () => ({ privateRecipeDrafts: drafts }));
const uuid = vi.hoisted(() => vi.fn());
vi.mock('expo-crypto', () => ({ randomUUID: uuid }));
import { captureSaveFailure, saveCaptureOrRecover } from './captureSave';

describe('capture save recovery', () => {
  beforeEach(() => uuid.mockReset().mockReturnValue('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));

  it('preserves the same capture ID and payload after a lost save response', async () => {
    const input = { extracted: { title: 'Rice' }, source_type: 'photo' as const, is_public: false };
    const save = vi.fn().mockRejectedValueOnce(new Error('Response timed out'));
    const destination = await saveCaptureOrRecover(input, 'Guam', save);
    expect(typeof destination).toBe('object');
    if (typeof destination === 'string') throw new Error('Expected recovery');
    const request = save.mock.calls[0][0];
    expect(destination.params.captureId).toBe(request.capture_id);
    expect(JSON.parse(destination.params.recipe)).toEqual(request.extracted);
    expect(destination.params.saveErrorMessage).toBe('Response timed out');
    const replay = vi.fn().mockResolvedValue({ id: 'original-recipe' });
    expect(await saveCaptureOrRecover({ ...input, capture_id: destination.params.captureId }, 'Guam', replay))
      .toBe('/recipe/original-recipe');
    expect(replay).toHaveBeenCalledWith(request);
    expect(uuid).toHaveBeenCalledTimes(1);
  });

  it.each([
    [422, 'invalid'], [400, 'invalid'], [401, 'auth'], [403, 'auth'],
    [409, 'conflict'], [429, 'retry'], [503, 'retry'], [undefined, 'retry'],
  ])('classifies HTTP %s for a useful recovery action', (status, kind) => {
    expect(captureSaveFailure({ response: { status } }).kind).toBe(kind);
  });

  it('keeps the API validation reason in the recovery destination', async () => {
    const result = await saveCaptureOrRecover({ extracted: {}, source_type: 'text', is_public: true }, 'Guam',
      async () => { throw { response: { status: 422, data: { detail: 'Invalid extracted recipe draft' } } }; });
    expect(result).toMatchObject({ params: { saveErrorKind: 'invalid', saveErrorMessage: 'Invalid extracted recipe draft' } });
  });
});

it('carries original pages into save-only recovery without discarding their local files', async () => {
  const original_pages = [{ uri: 'file:///private-recipe-drafts/account/page.jpg' }];
  const route = await saveCaptureOrRecover({ extracted: {}, source_type: 'photo', is_public: false, original_pages }, 'Guam',
    async () => { throw new Error('Original page storage unavailable'); });
  expect(route).toMatchObject({ params: { originalPages: JSON.stringify(original_pages), saveErrorKind: 'retry' } });
});

it('persists the exact scan request before making a server write', async () => {
  let finish!: () => void;
  drafts.write.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const original_pages = [{ uri: 'file:///private-recipe-drafts/account/page.jpg' }];
  const save = vi.fn(async () => ({ id: 'saved' }));
  const pending = saveCaptureOrRecover({ extracted: { title: 'Family' }, source_type: 'photo', is_public: false, expected_owner_id: 'owner', original_pages }, 'Guam', save);
  await Promise.resolve();
  expect(save).not.toHaveBeenCalled();
  expect(drafts.write).toHaveBeenLastCalledWith(expect.objectContaining({ owner: 'owner' }), 'recovery', expect.objectContaining({ request: expect.objectContaining({ original_pages }) }));
  finish();
  expect(await pending).toBe('/recipe/saved');
});
