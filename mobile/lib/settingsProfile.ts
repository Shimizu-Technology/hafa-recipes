interface SettingsProfileUser {
  firstName?: string | null;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
}

/** Resolve the account name shown and announced on the Settings profile card. */
export function resolveSettingsProfileName(
  isSignedIn: boolean | undefined,
  user: SettingsProfileUser | null | undefined,
): string {
  if (!isSignedIn) return 'Guest User';
  return user?.firstName || user?.primaryEmailAddress?.emailAddress?.split('@')[0] || 'User';
}
