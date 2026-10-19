/** OAuth and share receipt links are consumed by their native bridges. Keeping
 * them on the index route avoids an unmatched screen during foreground intake. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path.length > 8192 || /[\u0000-\u001f\u007f\\]/.test(path)) return "/";
  try {
    decodeURIComponent(path);
    const url = new URL(path, "hafababy://app");
    if (url.hostname === "oauth-callback" || url.hostname.startsWith("dataUrl=")) return "/";
    if (path.startsWith("/") && !path.includes("%") && !path.startsWith("//")) return path;
    if (url.protocol === "hafababy:") return "/";
    return path;
  } catch {
    return "/";
  }
}
