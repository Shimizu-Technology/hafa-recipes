export type GuestRecipeAction = 'save' | 'collection' | 'plan' | 'chat';
type Intent = { recipeId: string; action: GuestRecipeAction; expiresAt: number; session: string | null };
const TTL = 15 * 60_000;

/** One short-lived navigation intent; never recipe content, tokens or auth URL data. */
export function createGuestRecipeIntent(now = Date.now) {
  let intent: Intent | null = null;
  return {
    start(recipeId: string, action: GuestRecipeAction) {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(recipeId)) throw new Error('Invalid recipe ID');
      intent = { recipeId, action, expiresAt: now() + TTL, session: null };
    },
    clear() { intent = null; },
    bind(session: string | null) {
      if (!intent) return null;
      if (now() >= intent.expiresAt || (intent.session && intent.session !== session)) { intent = null; return null; }
      if (session) intent.session = session;
      return intent;
    },
    take(recipeId: string, session: string) {
      const current = this.bind(session);
      if (!current || current.recipeId !== recipeId || current.session !== session) return null;
      intent = null;
      return current.action;
    },
  };
}
export const guestRecipeIntent = createGuestRecipeIntent();
