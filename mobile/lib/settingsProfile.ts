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

interface ProfilePhotoUser {
  imageUrl?: string | null;
  /** Clerk sets this to false when `imageUrl` is only its generated default avatar. */
  hasImage?: boolean;
}

/** True when the account has a photo the person chose, not Clerk's generated placeholder. */
export function hasProfilePhoto<T extends ProfilePhotoUser>(
  user: T | null | undefined,
): user is T & { imageUrl: string } {
  return Boolean(user?.imageUrl) && user?.hasImage !== false;
}

/** First letter of the first name, falling back to the email, for an initials avatar. */
export function resolveProfileInitial(user: SettingsProfileUser | null | undefined): string | undefined {
  const source = user?.firstName?.trim() || resolveSettingsProfileEmail(user)?.trim();
  const first = source ? Array.from(source)[0] : undefined;
  return first ? first.toLocaleUpperCase() : undefined;
}
