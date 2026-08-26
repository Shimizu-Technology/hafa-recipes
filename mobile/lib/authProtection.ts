export type AuthProtectionRedirect = '/(tabs)' | '/(tabs)/discover' | null;

const AUTHENTICATED_CAPTURE_ROUTES = new Set(['add-recipe', 'paste-recipe']);

/** Return the redirect required at an authentication boundary, if any. */
export function getAuthProtectionRedirect(
  isSignedIn: boolean | undefined,
  firstSegment: string | undefined,
): AuthProtectionRedirect {
  if (isSignedIn && firstSegment === '(auth)') return '/(tabs)';
  if (!isSignedIn && firstSegment && AUTHENTICATED_CAPTURE_ROUTES.has(firstSegment)) {
    return '/(tabs)/discover';
  }
  return null;
}
