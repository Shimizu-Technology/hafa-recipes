/** Only classify a validated host, never a caption mentioning WodUp. */
export function isClassPage(source: string | null | undefined) {
  try {
    const url = new URL(source ?? "");
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && /(^|\.)wodup\.com$/i.test(url.hostname);
  } catch { return false; }
}
