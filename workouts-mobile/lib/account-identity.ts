/** The few Clerk user fields the Settings identity card reads. */
export interface IdentityUser {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  imageUrl?: string | null;
  /** Clerk sets this to false when `imageUrl` is only its generated default avatar. */
  hasImage?: boolean;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
  emailAddresses?: readonly { emailAddress?: string | null }[];
}

export interface AccountIdentity {
  /** Display name; falls back to the email's local part. */
  name: string;
  email?: string;
  /** One uppercase letter for the initials avatar; absent until the account loads. */
  initial?: string;
  /** A photo the person chose, never Clerk's generated placeholder. */
  photo?: string;
}

/** Who is signed in, in the plain form the Settings card shows. */
export function accountIdentity(user: IdentityUser | null | undefined): AccountIdentity {
  const email = (user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress)?.trim() || undefined;
  const joined = [user?.firstName?.trim(), user?.lastName?.trim()].filter(Boolean).join(" ");
  const known = user?.fullName?.trim() || joined || email?.split("@")[0];
  const first = Array.from(user?.firstName?.trim() || known || "")[0];
  const photo = user?.imageUrl && user.hasImage !== false ? user.imageUrl : undefined;
  return { name: known || "Your account", email, initial: first?.toLocaleUpperCase(), photo };
}
