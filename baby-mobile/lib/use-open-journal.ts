import { router, useNavigationContainerRef } from "expo-router";

type NavState = { routes: readonly { name: string; state?: NavState }[] };
/** Whether a Journal is already open somewhere under this page. */
export const journalOpen = (state?: NavState): boolean => !!state?.routes.some((route) => route.name === "journal" || journalOpen(route.state));
/** Journal as Today opens it: all her writing, whichever filter she last left it on. */
export const journalHome = () => ({ pathname: "/journal" as const, params: { filter: "all", at: String(Date.now()) } });

/**
 * To Journal from a page above it. One she came through still has her search, filter and place, so it's that one. Otherwise
 * it opens on top, on the kind of thing she was reading, and Back returns here.
 */
export function useOpenJournal() {
  const navigation = useNavigationContainerRef();
  return (kind?: string) => journalOpen(navigation.getRootState() as NavState | undefined) ? router.dismissTo("/journal")
    : router.push({ pathname: "/journal", params: { filter: kind === "question" ? "question" : "journal", at: String(Date.now()) } });
}
