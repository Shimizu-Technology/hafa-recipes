/** Only classify a validated host, never a caption mentioning WodUp. */
export function isClassPage(source: string | null | undefined) {
  try {
    const url = new URL(source ?? "");
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && /(^|\.)wodup\.com$/i.test(url.hostname);
  } catch { return false; }
}

/** A copied WodUp address is attribution, not workout instructions. */
export function classText(text: string) {
  return text.replace(/https?:\/\/[^\s<>"']+/gi, url => isClassPage(url) ? "" : url).trim();
}
export function classDate(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map(key => parts.find(p => p.type === key)!.value).join("-");
}
