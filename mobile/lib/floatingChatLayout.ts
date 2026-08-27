import { spacing } from '../constants/Colors';

const TAB_BAR_HEIGHT = 85;
const GUEST_PROMPT_HEIGHT = 82;

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

export function floatingChatBottom(isSignedIn: boolean): number {
  return TAB_BAR_HEIGHT + spacing.md + (isSignedIn ? 0 : GUEST_PROMPT_HEIGHT);
}
