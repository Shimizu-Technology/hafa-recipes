import { createContext, useContext, useMemo, type PropsWithChildren } from "react";
import { useUser } from "@clerk/expo";

export type AccountIdentity = { initial?: string; imageUrl?: string; name?: string; email?: string };

const AccountIdentityContext = createContext<AccountIdentity | null>(null);

type IdentityUser = {
  firstName?: string | null;
  fullName?: string | null;
  hasImage?: boolean;
  imageUrl?: string;
  primaryEmailAddress?: { emailAddress?: string } | null;
};

/** First letter of the first name, falling back to the email, like Håfa Recipes. */
export function accountIdentity(user: IdentityUser | null | undefined): AccountIdentity | null {
  if (!user) return null;
  const email = user.primaryEmailAddress?.emailAddress?.trim() || undefined;
  const source = user.firstName?.trim() || email;
  const first = source ? Array.from(source)[0] : undefined;
  return {
    initial: first?.toLocaleUpperCase(),
    imageUrl: user.hasImage !== false && user.imageUrl ? user.imageUrl : undefined,
    name: user.fullName?.trim() || undefined,
    email,
  };
}

/** Signed-in only: shares who is signed in with header chrome without each screen reading Clerk. */
export function AccountIdentityProvider({ children }: PropsWithChildren) {
  const { user } = useUser();
  const value = useMemo(
    () => accountIdentity(user),
    [user?.firstName, user?.fullName, user?.hasImage, user?.imageUrl, user?.primaryEmailAddress?.emailAddress]
  );
  return <AccountIdentityContext.Provider value={value}>{children}</AccountIdentityContext.Provider>;
}

/** Null outside the signed-in tree (and in screen tests), so callers fall back to a person glyph. */
export function useAccountIdentity() {
  return useContext(AccountIdentityContext);
}
