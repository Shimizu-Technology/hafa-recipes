interface SettingsProfileUser {
  firstName?: string | null;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
  emailAddresses?: readonly { emailAddress?: string | null }[];
}

/** Resolve the account name shown and announced on the Settings profile card. */
export function resolveSettingsProfileName(
  isSignedIn: boolean | undefined,
  user: SettingsProfileUser | null | undefined,
): string {
  if (!isSignedIn) return 'Guest User';
  return user?.firstName || user?.primaryEmailAddress?.emailAddress?.split('@')[0] || 'User';
}

/** Resolve the email shown on the Settings profile card. */
export function resolveSettingsProfileEmail(
  user: SettingsProfileUser | null | undefined,
): string | undefined {
  return user?.primaryEmailAddress?.emailAddress
    ?? user?.emailAddresses?.[0]?.emailAddress
    ?? undefined;
}
