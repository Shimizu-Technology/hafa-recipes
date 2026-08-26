import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appConfig = JSON.parse(readFileSync(fileURLToPath(new URL('./app.json', import.meta.url)), 'utf8'));

describe('native share extension configuration', () => {
  it('accepts recipe URLs, text, and up to ten images on iOS and Android', () => {
    const sharePlugin = appConfig.expo.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-share-intent',
    );
    const options = sharePlugin[1];

    expect(options.iosActivationRules).toEqual({
      NSExtensionActivationSupportsText: true,
      NSExtensionActivationSupportsWebURLWithMaxCount: 1,
      NSExtensionActivationSupportsWebPageWithMaxCount: 1,
      NSExtensionActivationSupportsImageWithMaxCount: 10,
    });
    expect(options.androidIntentFilters).toEqual(['text/*', 'image/*']);
    expect(options.androidMultiIntentFilters).toEqual(['image/*']);
  });
});
