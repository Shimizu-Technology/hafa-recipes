import { spacing } from '../constants/Colors';

const TAB_BAR_HEIGHT = 85;

/** Return whether the cooking assistant belongs on the current primary route. */
export function isFloatingChatPath(pathname: string): boolean {
  const tabRoutes = [
    '/',
    '/discover',
    '/history',
    '/planner',
    '/grocery',
    '/(tabs)',
    '/(tabs)/discover',
    '/(tabs)/history',
    '/(tabs)/planner',
    '/(tabs)/grocery',
  ];

  return tabRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/** Position the assistant above the tab bar and any measured guest prompt. */
export function floatingChatBottom(
  isSignedIn: boolean,
  guestPromptHeight: number,
): number {
  return TAB_BAR_HEIGHT + spacing.md + (isSignedIn ? 0 : guestPromptHeight);
}
