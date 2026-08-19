/** Decide whether a loaded Clerk identity transition crosses a privacy boundary. */
export function shouldClearPrivateQueryCache(
  previousUserId: string | null | undefined,
  currentUserId: string | null,
): boolean {
  return previousUserId !== undefined && previousUserId !== currentUserId;
}
