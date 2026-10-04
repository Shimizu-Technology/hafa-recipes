import { describe, expect, it, vi } from 'vitest';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
import { createImportPreferences } from './importPreferences';

function store() {
  const values = new Map<string, string>();
  const storage = { getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }) };
  return { preferences: createImportPreferences(storage), storage, values };
}
describe('account-scoped import preferences', () => {
  it('defaults new accounts public and keeps an explicit private choice across reloads', async () => {
    const { preferences, storage } = store();
    await preferences.hydrate('stable-a');
    expect(preferences.snapshot('stable-a')).toMatchObject({ ready: true, isPublic: true, location: 'Guam' });
    await preferences.update('stable-a', { isPublic: false });
    const reopened = createImportPreferences(storage);
    await reopened.hydrate('stable-a');
    expect(reopened.snapshot('stable-a').isPublic).toBe(false);
    await reopened.hydrate('stable-b');
    expect(reopened.snapshot('stable-b').isPublic).toBe(true);
  });
  it('serializes location and visibility updates without losing either choice', async () => {
    const { preferences } = store();
    await Promise.all([preferences.update('stable-a', { isPublic: false }), preferences.update('stable-a', { location: 'Hawaii' })]);
    expect(preferences.snapshot('stable-a')).toMatchObject({ isPublic: false, location: 'Hawaii' });
    expect(preferences.snapshot('stable-b').ready).toBe(false);
  });
  it('blocks imports when stored settings are corrupt and preserves the original bytes', async () => {
    const { preferences, values } = store();
    values.set('hafa_import_preferences_v1:stable-a', '{bad');
    await preferences.hydrate('stable-a');
    expect(preferences.snapshot('stable-a')).toMatchObject({ ready: false, error: expect.any(String) });
    expect(values.get('hafa_import_preferences_v1:stable-a')).toBe('{bad');
  });
  it('does not apply a preference the device failed to persist', async () => {
    const { preferences, storage } = store();
    await preferences.hydrate('stable-a');
    storage.setItem.mockRejectedValueOnce(new Error('Storage full'));
    await expect(preferences.update('stable-a', { isPublic: false })).rejects.toThrow('Storage full');
    expect(preferences.snapshot('stable-a').isPublic).toBe(true);
  });
});
