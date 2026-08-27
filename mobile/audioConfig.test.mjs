import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appConfig = JSON.parse(readFileSync(fileURLToPath(new URL('./app.json', import.meta.url)), 'utf8'));

describe('native audio configuration', () => {
  it('does not declare unsupported persistent background playback', () => {
    const audioPlugin = appConfig.expo.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-audio',
    );

    expect(audioPlugin).toEqual([
      'expo-audio',
      {
        enableBackgroundPlayback: false,
      },
    ]);
  });
});
