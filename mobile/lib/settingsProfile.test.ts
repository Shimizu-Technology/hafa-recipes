import { describe, expect, it } from 'vitest';

import { resolveSettingsProfileEmail, resolveSettingsProfileName } from './settingsProfile';

describe('settings profile presentation', () => {
  it('uses the primary address when a user has multiple emails and no first name', () => {
    const user = {
      firstName: null,
      emailAddresses: [
        { emailAddress: 'secondary@example.com' },
        { emailAddress: 'primary@example.com' },
      ],
      primaryEmailAddress: { emailAddress: 'primary@example.com' },
    };

    expect(resolveSettingsProfileName(true, user)).toBe('primary');
    expect(resolveSettingsProfileEmail(user)).toBe('primary@example.com');
  });

  it('uses a stable guest label while Clerk is signed out', () => {
    expect(resolveSettingsProfileName(false, null)).toBe('Guest User');
  });
});
