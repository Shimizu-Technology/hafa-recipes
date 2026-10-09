import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('uses a browser Blob and filename without loading native file APIs on web', async () => {
    mocks.platform = 'web';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['web photo'], { type: 'application/octet-stream' }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const form = new BrowserFormData();
      await appendRecipeImage(form, 'image', { uri: 'blob:photo', fileName: 'photo.png', mimeType: 'image/png' });
      const part = form.get('image') as File;
      expect(part.name).toBe('photo.png');
      expect(part.type).toBe('image/png');
      expect(await part.text()).toBe('web photo');
      expect(mocks.constructors).not.toHaveBeenCalled();
      const encoded = await convertFormDataAsync(form);
      expect(decode(encoded.body)).toContain('filename="photo.png"');
      expect(decode(encoded.body)).toContain('web photo');
    } finally { vi.unstubAllGlobals(); }
  });
});
