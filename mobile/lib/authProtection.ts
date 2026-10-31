export type AuthProtectionRedirect = ReturnType<typeof postSignInRoute> | '/(tabs)/discover' | null;

/** Only known capture entries can become a post-auth destination. */
export function postSignInRoute(entry: unknown) {
  return entry === 'scan' || entry === 'photos' ? `/?entry=${entry}` as const : '/(tabs)/recipes' as const;
}

const AUTHENTICATED_CAPTURE_ROUTES = new Set(['add-recipe', 'paste-recipe', 'edit-capture', 'ocr-review']);

/** Return the redirect required at an authentication boundary, if any. */
export function getAuthProtectionRedirect(
  isSignedIn: boolean | undefined,
  firstSegment: string | undefined,
  entry?: unknown,
): AuthProtectionRedirect {
  if (isSignedIn && firstSegment === '(auth)') return postSignInRoute(entry);
  if (!isSignedIn && firstSegment && AUTHENTICATED_CAPTURE_ROUTES.has(firstSegment)) {
    return '/(tabs)/discover';
  }
  return null;
}
