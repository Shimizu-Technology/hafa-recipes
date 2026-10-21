/** An intent belongs to the account present at intake, before async file copies.
 * Ownerless intents stay quarantined; a later login must not claim them. */
export function createStockShareScope() {
  const captures = new WeakMap<object, { binding: string | null; owner?: string; generation?: number; retired?: boolean }>();
  let active: string | null = null;
  return {
    observe(intent: object, binding: string | null) {
      active = binding;
      const previous = captures.get(intent);
      if (previous && previous.binding !== binding) previous.retired = true;
      if (!previous) captures.set(intent, { binding });
    },
    allow(intent: object, owner: string, generation: number) {
      const captured = captures.get(intent);
      if (!captured?.binding || captured.retired || captured.binding !== active) return false;
      if (!captured.owner) Object.assign(captured, { owner, generation });
      return captured.owner === owner && captured.generation === generation;
    },
  };
}
export const stockShareScope = createStockShareScope();
