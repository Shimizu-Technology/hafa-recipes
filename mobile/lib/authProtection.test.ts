import { describe, expect, it } from 'vitest';

import { getAuthProtectionRedirect } from './authProtection';

describe('authentication route protection', () => {
  it('redirects signed-out users away from every authenticated capture route', () => {
    expect(getAuthProtectionRedirect(false, 'add-recipe')).toBe('/(tabs)/discover');
    expect(getAuthProtectionRedirect(false, 'paste-recipe')).toBe('/(tabs)/discover');
  });

  it('redirects signed-in users away from authentication screens', () => {
    expect(getAuthProtectionRedirect(true, '(auth)')).toBe('/(tabs)');
  });

  it('does not redirect signed-in capture routes or unrelated guest routes', () => {
    expect(getAuthProtectionRedirect(true, 'paste-recipe')).toBeNull();
    expect(getAuthProtectionRedirect(false, 'discover')).toBeNull();
    expect(getAuthProtectionRedirect(undefined, undefined)).toBeNull();
  });
});
