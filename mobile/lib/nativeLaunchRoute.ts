import { recipeLinkRoute } from './recipeLinkRoute';

/** The share card opens this URL only after an explicit open-in-app action. */
export function shareOpenCaptureKey(path: string | null): string | null {
  const match = path?.match(/^hafarecipes:\/\/dataUrl=([^?#]+)(?:\?[^#]*)?#(?:text|weburl|url|file|image|media)$/i);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

/** Preserve capture parameters while moving legacy hidden-tab routes onto the root stack. */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  // Seed/retain tabs; durable intake pushes Import only for the matching
  // explicit share-card URL. Linking still delivers the original URL to intake.
  if (shareOpenCaptureKey(path)) return '/(tabs)/recipes';
  // hafa-recipes.com/r/<recipe id> opens the recipe; an unlisted key opens the shared view.
  const recipeLink = recipeLinkRoute(path);
  if (recipeLink) return recipeLink;
  const legacy = path.match(/^\/\(tabs\)\/(index|history)\/?([?#].*)?$/);
  if (legacy) return `${legacy[1] === 'index' ? '/' : '/history'}${legacy[2] ?? ''}`;
  if (/^\/index\/?([?#].*)?$/.test(path)) return path.replace(/^\/index\/?/, '/');
  if (initial && (path === '/' || path === '')) return '/(tabs)/recipes';
  try {
    const url = new URL(path);
    const isApp = url.protocol === 'hafarecipes:';
    const isExpo = url.protocol === 'exp:' || url.protocol === 'exps:' || /^exp\+[^:]+:$/.test(url.protocol);
    if (isApp && ['', '/'].includes(url.pathname) && ['index', 'history'].includes(url.hostname)) {
      return `${url.hostname === 'index' ? '/' : '/history'}${url.search}${url.hash}`;
    }
    const oldPath = (isApp && url.hostname === '(tabs)' ? url.pathname.match(/^\/(index|history)\/?$/) : null)
      ?? url.pathname.match(/^\/(?:--\/)?\(tabs\)\/(index|history)\/?$/);
    if (oldPath && (isApp || isExpo)) {
      return `${oldPath[1] === 'index' ? '/' : '/history'}${url.search}${url.hash}`;
    }
    const root = ['', '/', '/--/'].includes(url.pathname);
    const appRoot = isApp && !url.hostname;
    const developmentRoot = isExpo;
    if (initial && root && !url.search && !url.hash && (appRoot || developmentRoot)) return '/(tabs)/recipes';
  } catch { /* Malformed/external capture payloads remain owned by the existing intake. */ }
  return path;
}
