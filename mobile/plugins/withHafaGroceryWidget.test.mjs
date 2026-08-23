import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = require('./withHafaGroceryWidget.js');
const {
  APP_GROUP,
  BUNDLE_SUFFIX,
  KEYCHAIN_GROUP,
  RESOURCE_FILES,
  SOURCE_FILES,
  TARGET_NAME,
  configureEasExtension,
  mainAppKeychainGroups,
} = plugin._testing;

describe('Håfa grocery widget config plugin', () => {
  it('declares the EAS extension with least-privilege entitlements', () => {
    const config = configureEasExtension({
      ios: { bundleIdentifier: 'com.shimizutechnology.recipeextractor' },
      extra: {
        eas: {
          build: {
            experimental: {
              ios: {
                appExtensions: [
                  {
                    targetName: 'ShareExtension',
                    bundleIdentifier: 'com.shimizutechnology.recipeextractor.share-extension',
                  },
                ],
              },
            },
          },
        },
      },
    });

    const extensions = config.extra.eas.build.experimental.ios.appExtensions;
    expect(extensions).toHaveLength(2);
    expect(extensions[0].targetName).toBe('ShareExtension');
    expect(extensions[1]).toEqual({
      targetName: TARGET_NAME,
      bundleIdentifier: `com.shimizutechnology.recipeextractor${BUNDLE_SUFFIX}`,
      entitlements: {
        'com.apple.security.application-groups': [APP_GROUP],
        'keychain-access-groups': [KEYCHAIN_GROUP],
      },
    });
  });

  it('updates the declaration without duplicating the extension', () => {
    const config = {
      ios: { bundleIdentifier: 'com.shimizutechnology.recipeextractor' },
      extra: {
        eas: {
          build: {
            experimental: {
              ios: {
                appExtensions: [
                  {
                    targetName: TARGET_NAME,
                    bundleIdentifier: 'wrong.bundle',
                    entitlements: { preserved: true },
                  },
                ],
              },
            },
          },
        },
      },
    };

    configureEasExtension(config);
    configureEasExtension(config);

    const extensions = config.extra.eas.build.experimental.ios.appExtensions;
    expect(extensions).toHaveLength(1);
    expect(extensions[0].bundleIdentifier).toBe(
      'com.shimizutechnology.recipeextractor.grocery-widget',
    );
    expect(extensions[0].entitlements.preserved).toBe(true);
  });

  it('uses Apple\'s required privacy manifest basename', () => {
    expect(RESOURCE_FILES).toEqual(['PrivacyInfo.xcprivacy']);
  });

  it('compiles the paging intent and helper into the widget target', () => {
    expect(SOURCE_FILES).toContain('HafaWidgetPaging.swift');
    expect(SOURCE_FILES).toContain('ChangeGroceryWidgetPageIntent.swift');
  });

  it('keeps interactive widget reloads cache-first with immediate feedback', () => {
    const widgetSource = readFileSync(
      join(mobileRoot, 'widget/ios/HafaGroceryWidget.swift'),
      'utf8',
    );
    const sharedSource = readFileSync(
      join(mobileRoot, 'modules/hafa-widget-bridge/ios/HafaWidgetShared.swift'),
      'utf8',
    );
    const pageIntentSource = readFileSync(
      join(mobileRoot, 'widget/ios/ChangeGroceryWidgetPageIntent.swift'),
      'utf8',
    );
    const checkIntentSource = readFileSync(
      join(mobileRoot, 'widget/ios/SetGroceryItemCheckedIntent.swift'),
      'utf8',
    );

    expect(widgetSource).toContain('if cachedState.shouldUseCachedTimeline()');
    expect(widgetSource).toContain('Toggle(');
    expect(widgetSource).toContain('.invalidatableContent()');
    expect(sharedSource).toContain('state.markTimelineCacheFresh()');
    expect(pageIntentSource).not.toContain('reloadTimelines');
    expect(checkIntentSource).not.toContain('reloadTimelines');
  });

  it('keeps the app-private keychain group ahead of the shared widget group', () => {
    const groups = mainAppKeychainGroups(
      'com.shimizutechnology.recipeextractor',
      ['$(AppIdentifierPrefix)existing.group', KEYCHAIN_GROUP],
    );

    expect(groups).toEqual([
      '$(AppIdentifierPrefix)com.shimizutechnology.recipeextractor',
      '$(AppIdentifierPrefix)existing.group',
      KEYCHAIN_GROUP,
    ]);
    expect(groups.filter((group) => group === KEYCHAIN_GROUP)).toHaveLength(1);
  });
});
