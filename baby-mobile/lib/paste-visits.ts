/** No provider, inferred year, clinical interpretation or rewriting. Spans cover the original exactly. */
export interface PastedItem { text: string; start: number; end: number; day: string }
export function pasteVisits(original: string): PastedItem[] {
  const starts = [...original.matchAll(/^[ \t]*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?) \d{1,2}(?:,? \d{4})?)(?=\s|$|:)/gmi)];
  if (!starts.length) return [{ text: original, start: 0, end: original.length, day: "" }];
  const boundaries = starts.map((match) => ({ start: match.index!, day: explicitDay(match[1]) }));
  if (boundaries[0].start > 0) boundaries.unshift({ start: 0, day: "" });
  return boundaries.map((item, index) => {
    const end = boundaries[index + 1]?.start ?? original.length;
    return { text: original.slice(item.start, end), start: item.start, end, day: validDay(item.day) ? item.day : "" };
  });
}
export function validDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
}

/** Only explicit four-digit years and named months/ISO have an unambiguous interpretation. */
function explicitDay(text: string): string {
  if (validDay(text)) return text;
  const match = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?) (\d{1,2}),? (\d{4})$/i.exec(text);
  if (!match) return "";
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
  const day = `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return validDay(day) ? day : "";
}
