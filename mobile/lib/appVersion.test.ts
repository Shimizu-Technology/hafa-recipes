import { describe, expect, it } from 'vitest';

import appConfig from '../app.json';
import { resolveAppVersion } from './appVersion';

describe('resolveAppVersion', () => {
  it('uses the runtime version when Expo provides one', () => {
    expect(resolveAppVersion('9.8.7')).toBe('9.8.7');
  });

  it('falls back to the release version declared in app.json', () => {
    expect(resolveAppVersion(undefined)).toBe(appConfig.expo.version);
  });
});
