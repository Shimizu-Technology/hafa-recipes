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
  FONT_FILES,
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

  it('bundles the app\'s Figtree faces from the package the app loads', () => {
    const infoPlist = readFileSync(join(mobileRoot, 'widget/ios/Info.plist'), 'utf8');
    for (const [file, packagePath] of Object.entries(FONT_FILES)) {
      expect(require.resolve(packagePath, { paths: [mobileRoot] })).toMatch(/\.ttf$/);
      expect(infoPlist).toContain(`<string>${file}</string>`);
    }
  });

  it('compiles the list layout, check-off and fold intents but not the retired paging', () => {
    expect(SOURCE_FILES).toEqual(expect.arrayContaining([
      'HafaWidgetSections.swift',
      'HafaWidgetListLayout.swift',
      'HafaWidgetPalette.swift',
      'SetGroceryItemCheckedIntent.swift',
      'ToggleGrocerySectionIntent.swift',
    ]));
    expect(SOURCE_FILES).not.toContain('HafaWidgetPaging.swift');
    expect(SOURCE_FILES).not.toContain('ChangeGroceryWidgetPageIntent.swift');
    expect(SOURCE_FILES).not.toContain('ToggleGroceryWidgetSectionIntent.swift');
    for (const file of SOURCE_FILES.filter((name) => name !== 'HafaWidgetShared.swift')) {
      expect(() => readFileSync(join(mobileRoot, 'widget/ios', file))).not.toThrow();
    }
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
    const checkIntentSource = readFileSync(
      join(mobileRoot, 'widget/ios/SetGroceryItemCheckedIntent.swift'),
      'utf8',
    );

    expect(widgetSource).toContain('if cachedState.shouldUseCachedTimeline()');
    expect(widgetSource).toContain('Toggle(');
    expect(widgetSource).toContain('.invalidatableContent()');
    expect(widgetSource).toContain('HafaWidgetListLayout.make(');
    expect(widgetSource).toContain('pendingItemIDs: Set(entry.state.pending.map(\\.itemID))');
    expect(widgetSource).toContain('@ScaledMetric');
    expect(widgetSource).not.toContain('ChangeGroceryWidgetPageIntent');
    expect(widgetSource).not.toContain('ToggleGroceryWidgetSectionIntent');
    expect(sharedSource).toContain('state.markTimelineCacheFresh()');
    expect(checkIntentSource).not.toContain('reloadTimelines');
    const foldIntentSource = readFileSync(join(mobileRoot, 'widget/ios/ToggleGrocerySectionIntent.swift'), 'utf8');
    expect(foldIntentSource).toContain('toggleCollapsedSection(accountScopeID: accountScopeID, listID: listID, key: sectionKey)');
    expect(foldIntentSource).not.toContain('reloadTimelines');
    expect(sharedSource).toContain('state.markTimelineCacheFresh(now: now)');
  });

  it('uses the app\'s Calm colors with contrast and tinted-mode fallbacks', () => {
    const widgetSource = readFileSync(
      join(mobileRoot, 'widget/ios/HafaGroceryWidget.swift'),
      'utf8',
    );
    const paletteSource = readFileSync(
      join(mobileRoot, 'widget/ios/HafaWidgetPalette.swift'),
      'utf8',
    );
    const colors = readFileSync(join(mobileRoot, 'constants/Colors.ts'), 'utf8');

    expect(widgetSource).toContain('@Environment(\\.colorScheme)');
    expect(widgetSource).toContain('@Environment(\\.colorSchemeContrast)');
    expect(widgetSource).toContain('@Environment(\\.widgetRenderingMode)');
    expect(widgetSource).toContain('.widgetAccentable()');
    expect(paletteSource).toContain('renderingMode == .fullColor');
    expect(paletteSource).toContain('contrast == .increased');
    // Each widget color is one of the app's tokens.
    for (const token of ['1A1D1C', 'ECEEEC', '222222', '6A6A66', '9BA19E', '145E52', '8CCFBE', '17695B', '1B7466', 'E7E7E3', '2A2E2C']) {
      expect(paletteSource).toContain(`0x${token}`);
      expect(colors).toContain(`#${token}`);
    }
    expect(paletteSource).not.toContain('FFF7EC');
    expect(paletteSource).not.toContain('69C8BA');
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
