/**
 * Splits a format label into a big cover numeral and its caption ("45 min" → 45 / "min", "EMOM 10" → 10 / "EMOM").
 * Only a label with exactly one standalone number splits; "Every 90s × 8" or "E2MOM × 10" keep the whole label as the
 * caption so the cover never shows a stray digit or a mangled word.
 */
export function formatNumeral(label: string | null | undefined): { numeral: string | null; caption: string } {
  const text = (label ?? "").trim();
  const runs = text.match(/\d+/g) ?? [];
  const token = text.match(/(?:^|\s)(\d+)(?=\s|$)/);
  if (runs.length !== 1 || !token) return { numeral: null, caption: text };
  return { numeral: token[1], caption: text.replace(token[0], token[0].startsWith(" ") ? " " : "").replace(/\s+/g, " ").trim() };
}
