import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { synchronizeExtensionBuildVersions } =
  require('./withHafaExtensionBuildVersions.js')._testing;

function configuration(productName, build = '32', version = '2.4.0') {
  return {
    buildSettings: {
      PRODUCT_NAME: `"${productName}"`,
      CURRENT_PROJECT_VERSION: `"${build}"`,
      MARKETING_VERSION: `"${version}"`,
    },
  };
}

describe('iOS extension release versions', () => {
  it('keeps the grocery widget and share extension on the exact app build', () => {
    const app = configuration('HafaRecipes', '56', '2.5.3');
    const share = configuration('ShareExtension');
    const widget = configuration('HafaGroceryWidget', '55');
    const unrelated = configuration('UnrelatedExtension', '9', '1.0.0');
    const project = {
      pbxXCBuildConfigurationSection: () => ({ app, share, widget, unrelated }),
    };

    expect(synchronizeExtensionBuildVersions(project, {
      buildNumber: '56',
      version: '2.5.3',
    })).toEqual(new Set(['ShareExtension', 'HafaGroceryWidget']));

    expect(share.buildSettings.CURRENT_PROJECT_VERSION).toBe('"56"');
    expect(widget.buildSettings.CURRENT_PROJECT_VERSION).toBe('"56"');
    expect(share.buildSettings.MARKETING_VERSION).toBe('"2.5.3"');
    expect(widget.buildSettings.MARKETING_VERSION).toBe('"2.5.3"');
    expect(app.buildSettings.CURRENT_PROJECT_VERSION).toBe('"56"');
    expect(unrelated.buildSettings.CURRENT_PROJECT_VERSION).toBe('"9"');
  });

  it('fails before release when either extension is missing', () => {
    const project = {
      pbxXCBuildConfigurationSection: () => ({ share: configuration('ShareExtension') }),
    };

    expect(() => synchronizeExtensionBuildVersions(project, {
      buildNumber: '56',
      version: '2.5.3',
    })).toThrow('HafaGroceryWidget');
  });

  it('rejects malformed versions instead of producing an unshippable archive', () => {
    const project = {
      pbxXCBuildConfigurationSection: () => ({
        share: configuration('ShareExtension'),
        widget: configuration('HafaGroceryWidget'),
      }),
    };

    expect(() => synchronizeExtensionBuildVersions(project, {
      buildNumber: '56-beta',
      version: '2.5.3',
    })).toThrow('numeric build number');
    expect(() => synchronizeExtensionBuildVersions(project, {
      buildNumber: '56',
      version: '2.5.3-beta',
    })).toThrow('marketing version');
  });
});
