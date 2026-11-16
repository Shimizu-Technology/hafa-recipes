const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Unlisted keys are 32 random bytes in URL-safe base64 (43 characters). */
const UNLISTED_KEY = /^[A-Za-z0-9_-]{43}$/;

export type RecipeLinkTarget = { kind: 'recipe'; id: string } | { kind: 'unlisted'; key: string };

/** Classify the key in /r/<key>: a recipe ID opens the recipe, a 43-character key is an unlisted link. */
export function classifyRecipeLinkKey(key: string | null | undefined): RecipeLinkTarget | null {
  if (!key) return null;
  if (UUID.test(key)) return { kind: 'recipe', id: key.toLowerCase() };
  if (UNLISTED_KEY.test(key)) return { kind: 'unlisted', key };
  return null;
}

/** The app route for a hafa-recipes.com/r/<key> universal link, or null when the URL is something else. */
export function recipeLinkRoute(path: string): string | null {
  let pathname = path;
  if (/^https?:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (!/^(?:www\.)?hafa-recipes\.com$/i.test(url.hostname)) return null;
      pathname = url.pathname;
    } catch {
      return null;
    }
  }
  const key = pathname.match(/^\/r\/([^/?#]+)\/?(?:[?#].*)?$/)?.[1];
  const target = classifyRecipeLinkKey(key);
  if (!target) return null;
  return target.kind === 'recipe' ? `/recipe/${target.id}` : `/r/${target.key}`;
}

/** Unlisted links are capabilities: strip the key from anything that may reach logs or crash reports. */
export function redactRecipeLinks(text: string): string {
  return text.replace(/(\/(?:public\/)?r\/)[A-Za-z0-9_-]{8,}/g, '$1[redacted]');
}
