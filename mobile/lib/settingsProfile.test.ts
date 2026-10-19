import { describe, expect, it } from 'vitest';

import {
  hasProfilePhoto,
  resolveProfileInitial,
  resolveSettingsProfileEmail,
  resolveSettingsProfileName,
} from './settingsProfile';

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

  it('falls back to the first email when Clerk has no primary address', () => {
    expect(resolveSettingsProfileEmail({
      primaryEmailAddress: null,
      emailAddresses: [{ emailAddress: 'fallback@example.com' }],
    })).toBe('fallback@example.com');
  });

  it('returns no visible email when Clerk has no address', () => {
    expect(resolveSettingsProfileEmail({ emailAddresses: [] })).toBeUndefined();
    expect(resolveSettingsProfileEmail(null)).toBeUndefined();
  });

  it('treats Clerk\'s generated default avatar as no photo', () => {
    expect(hasProfilePhoto({ imageUrl: 'https://img.clerk.com/default', hasImage: false })).toBe(false);
    expect(hasProfilePhoto({ imageUrl: 'https://img.clerk.com/me', hasImage: true })).toBe(true);
    expect(hasProfilePhoto({ imageUrl: null, hasImage: true })).toBe(false);
    expect(hasProfilePhoto(null)).toBe(false);
  });

  it('builds an initial from the first name, then the email', () => {
    expect(resolveProfileInitial({ firstName: 'leon' })).toBe('L');
    expect(resolveProfileInitial({ firstName: '  ', primaryEmailAddress: { emailAddress: 'cook@example.com' } })).toBe('C');
    expect(resolveProfileInitial({ firstName: 'Ånna' })).toBe('Å');
    expect(resolveProfileInitial({ emailAddresses: [] })).toBeUndefined();
  });
});
