/** `shared-save` resumes saving a recipe opened from a Håfa link; its ID is the link key (memory only). */
export type GuestRecipeAction = 'save' | 'collection' | 'plan' | 'chat' | 'shared-save';
type Intent = { recipeId: string; action: GuestRecipeAction; expiresAt: number; session: string | null; servings?: number };
const TTL = 15 * 60_000;

/** One short-lived, in-memory navigation intent; never recipe content, auth tokens or auth URL data. A shared-save ID is a link key and never leaves memory. */
export function createGuestRecipeIntent(now = Date.now) {
  let intent: Intent | null = null;
  let generation = 0;
  let boundSession: string | null = null;
  return {
    start(recipeId: string, action: GuestRecipeAction, servings?: number) {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(recipeId)) throw new Error('Invalid recipe ID');
      generation++; boundSession = null;
      intent = { recipeId, action, expiresAt: now() + TTL, session: null, ...(Number.isInteger(servings) && servings! >= 1 && servings! <= 1000 ? { servings } : {}) };
    },
    clear() { generation++; boundSession = null; intent = null; },
    bind(session: string | null) {
      if (boundSession && boundSession !== session) this.clear();
      if (!intent) return null;
      if (now() >= intent.expiresAt || (intent.session && intent.session !== session)) { intent = null; return null; }
      if (session) { intent.session = session; boundSession = session; }
      return intent;
    },
    take(recipeId: string, session: string) {
      const current = this.bind(session);
      if (!current || current.recipeId !== recipeId || current.session !== session) return null;
      intent = null;
      const lease = generation;
      return { ...current, guard: () => {
        if (generation !== lease || boundSession !== session || now() >= current.expiresAt) throw new Error('Guest action expired or account changed');
      } };
    },
  };
}
export const guestRecipeIntent = createGuestRecipeIntent();
