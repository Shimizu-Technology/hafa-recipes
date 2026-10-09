import { beforeEach, describe, expect, it, vi } from 'vitest';
// Exercise the installed Expo converter directly to catch native protocol drift.
// Review these private import paths during SDK upgrades and retain native upload QA.
import { convertFormDataAsync } from '../node_modules/expo/src/winter/fetch/convertFormData';
import { installFormDataPatch } from '../node_modules/expo/src/winter/FormData';
import { appendRecipeImage } from './imageMultipart';

const mocks = vi.hoisted(() => ({ platform: 'ios', reads: vi.fn(), constructors: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { get OS() { return mocks.platform; } } }));
vi.mock('expo-file-system', () => ({ File: class {
  constructor(uri: string) { mocks.constructors(uri); }
  bytes() { return mocks.reads(); }
} }));
class NativeFormData { _parts: [string, unknown][] = []; }
const NativePatchedFormData = installFormDataPatch(NativeFormData as unknown as typeof FormData);
const BrowserFormData = globalThis.FormData;
const decode = (body: Uint8Array) => new TextDecoder().decode(body);

beforeEach(() => {
  mocks.platform = 'ios';
  mocks.constructors.mockClear();
  mocks.reads.mockReset().mockResolvedValue(new TextEncoder().encode('photo bytes'));
});

describe('SDK 57 image multipart compatibility', () => {
  it('reproduces Expo rejecting the legacy URI-only part', async () => {
    const form = new NativePatchedFormData();
    form.append('image', { uri: 'file:///photo.jpg', name: 'photo.jpg', type: 'image/jpeg' });
    await expect(convertFormDataAsync(form as unknown as FormData)).rejects.toThrow('Unsupported FormDataPart implementation');
  });

  it.each(['ios', 'android'])('serializes a lazy File-backed part with exact metadata on %s', async (platform) => {
    mocks.platform = platform;
    const form = new NativePatchedFormData() as unknown as FormData;
    form.append('recipe_data', '{"title":"Kelaguen"}');
    await appendRecipeImage(form, 'image', { uri: 'file:///shared/opaque', fileName: 'recipe.webp', mimeType: 'image/webp' });
    expect(mocks.constructors).toHaveBeenCalledWith('file:///shared/opaque');
    expect(mocks.reads).not.toHaveBeenCalled();
    const encoded = await convertFormDataAsync(form, 'test-boundary');
    expect(encoded.boundary).toBe('test-boundary');
    expect(decode(encoded.body)).toContain('name="image"; filename="recipe.webp"');
    expect(decode(encoded.body)).toContain('content-type: image/webp');
    expect(decode(encoded.body)).toContain('photo bytes');
    expect(decode(encoded.body)).toContain('Kelaguen');
    expect(mocks.reads).toHaveBeenCalledTimes(1);
  });

  it('retains repeated image fields, URI inference, and propagates native read failures', async () => {
    const form = new NativePatchedFormData() as unknown as FormData;
    await appendRecipeImage(form, 'images', 'file:///front.PNG?cache=1');
    await appendRecipeImage(form, 'images', 'file:///back.heic');
    const encoded = await convertFormDataAsync(form);
    expect(decode(encoded.body)).toContain('filename="front.PNG"');
    expect(decode(encoded.body)).toContain('content-type: image/png');
    expect(decode(encoded.body)).toContain('content-type: image/heic');
    expect(Array.from(form.entries()).filter(([field]) => field === 'images')).toHaveLength(2);
    mocks.reads.mockRejectedValue(new Error('Selected image no longer exists'));
    await expect(convertFormDataAsync(form)).rejects.toThrow('Selected image no longer exists');
  });

  it.each([
    { image: 'blob:opaque-id', blobType: 'image/png', expected: 'image/png', expectedName: 'blob:opaque-id' },
    { image: { uri: 'blob:photo', fileName: 'dish.jpg' }, blobType: 'image/png', expected: 'image/png', expectedName: 'dish.jpg' },
    { image: { uri: 'blob:photo', fileName: 'photo.png', mimeType: 'image/webp' }, blobType: 'image/png', expected: 'image/webp', expectedName: 'photo.png' },
    { image: { uri: 'blob:photo', fileName: 'photo.png' }, blobType: 'application/octet-stream', expected: 'image/png', expectedName: 'photo.png' },
  ])('preserves web MIME priority and binary content ($expected)', async ({ image, blobType, expected, expectedName }) => {
    mocks.platform = 'web';
    const payload = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([payload], { type: blobType }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const form = new BrowserFormData();
      await appendRecipeImage(form, 'image', image);
      const part = form.get('image') as File;
      expect(part.name).toBe(expectedName);
      expect(part.type).toBe(expected);
      expect(new Uint8Array(await part.arrayBuffer())).toEqual(payload);
      expect(mocks.constructors).not.toHaveBeenCalled();
      const encoded = await convertFormDataAsync(form);
      expect(decode(encoded.body)).toContain(`filename="${encodeURIComponent(expectedName)}"`);
      expect(decode(encoded.body)).toContain(`content-type: ${expected}`);
      expect(decode(encoded.body)).toContain('\r\n\r\n\u0001\u0002\u0003\r\n');
    } finally { vi.unstubAllGlobals(); }
  });

});
