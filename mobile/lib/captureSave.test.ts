import { beforeEach, describe, expect, it, vi } from 'vitest';

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
