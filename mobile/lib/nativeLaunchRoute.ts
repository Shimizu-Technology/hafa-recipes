/** Preserve capture parameters while moving legacy hidden-tab routes onto the root stack. */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  const legacy = path.match(/^\/\(tabs\)\/(index|history)([?#].*)?$/);
  if (legacy) return `${legacy[1] === 'index' ? '/' : '/history'}${legacy[2] ?? ''}`;
  if (/^\/index([?#].*)?$/.test(path)) return path.replace('/index', '/');
  if (initial && (path === '/' || path === '')) return '/(tabs)/recipes';
  try {
    const url = new URL(path);
    const isApp = url.protocol === 'hafarecipes:';
    if (isApp && ['', '/'].includes(url.pathname) && ['index', 'history'].includes(url.hostname)) {
      return `${url.hostname === 'index' ? '/' : '/history'}${url.search}${url.hash}`;
    }
    const oldPath = url.pathname.match(/^\/(?:--\/)?\(tabs\)\/(index|history)$/);
    if (oldPath && (isApp || url.protocol === 'exp:' || url.protocol === 'exps:')) {
      return `${oldPath[1] === 'index' ? '/' : '/history'}${url.search}${url.hash}`;
    }
    const root = ['', '/', '/--/'].includes(url.pathname);
    const appRoot = isApp && !url.hostname;
    const developmentRoot = url.protocol === 'exp:' || url.protocol === 'exps:';
    if (initial && root && !url.search && !url.hash && (appRoot || developmentRoot)) return '/(tabs)/recipes';
  } catch { /* Malformed/external capture payloads remain owned by the existing intake. */ }
  return path;
}
