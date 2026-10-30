/** A home-screen launch opens Recipes; explicit capture/deep links keep their routes. */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  if (!initial) return path;
  if (path === '/' || path === '') return '/(tabs)/recipes';
  try {
    const url = new URL(path);
    const root = ['', '/', '/--/'].includes(url.pathname);
    const appRoot = url.protocol === 'hafarecipes:' && !url.hostname;
    const developmentRoot = url.protocol === 'exp:' || url.protocol === 'exps:';
    if (root && !url.search && !url.hash && (appRoot || developmentRoot)) return '/(tabs)/recipes';
  } catch { /* Leave external/malformed capture routes to the existing intake. */ }
  return path;
}
