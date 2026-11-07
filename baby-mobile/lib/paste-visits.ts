/** Source offsets are UTF-16 offsets, matching the original phone string exactly. */
export interface PastedItem { text: string; start: number; end: number; day: string; title?: string; kind?: "event" | "journal"; age?: string; yearless?: string }
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const named = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?) (\d{1,2})(?:st|nd|rd|th)?(?:,? ((?:19|20|21)\d{2}))?\b/i;
export function validDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
}
export function pasteVisits(original: string): PastedItem[] {
  const starts = new Set<number>([0]);
  // Paragraphs preserve visit labels before dates; consecutive ISO/numeric date lines also split ordinary lists.
  for (const match of original.matchAll(/(?:^|\r?\n[ \t]*\r?\n)([^\r\n]+)/g)) {
    const at = match.index! + match[0].length - match[1].length;
    if (named.test(match[1]) || /\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}/.test(match[1])) starts.add(at);
  }
  for (const match of original.matchAll(/^[ \t]*(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d)/gmi)) {
    const prior = original.slice([...starts].filter((at) => at <= match.index!).sort((a, b) => b - a)[0], match.index);
    if (!/^\d+(?:st|nd|rd|th) visit\b/i.test(prior)) starts.add(match.index!);
  }
  const boundaries = [...starts].sort((a, b) => a - b);
  return boundaries.map((start, index) => {
    const end = boundaries[index + 1] ?? original.length, text = original.slice(start, end), line = text.split(/\r?\n/)[0], date = named.exec(line), iso = /\b\d{4}-\d{2}-\d{2}\b/.exec(line)?.[0];
    const yearless = date ? `${String(months.indexOf(date[1].slice(0, 3).toLowerCase()) + 1).padStart(2, "0")}-${date[2].padStart(2, "0")}` : "";
    const day = iso ?? (date?.[3] ? `${date[3]}-${yearless}` : "");
    const visit = /^\d+(?:st|nd|rd|th) visit\b/i.test(line);
    const title = visit ? line.split(/\s+-\s+/)[0] : date ? line : undefined;
    const age = text.split(/\r?\n/).find((one) => /^\s*\d{1,2} weeks?(?: \d{1,2} days)?(?: currently)?\s*$/i.test(one));
    return { text, start, end, day: validDay(day) ? day : "", ...(yearless && !date?.[3] ? { yearless } : {}), ...(title ? { title, kind: visit ? "event" as const : "journal" as const } : date && !visit ? { kind: "journal" as const } : {}), ...(age ? { age } : {}) };
  });
}
/** Only the user's explicit year choice resolves a yearless source date. */
export function withPasteYear<T extends PastedItem>(items: T[], year: string): T[] {
  return /^\d{4}$/.test(year) ? items.map((row) => row.yearless && validDay(`${year}-${row.yearless}`) ? { ...row, day: `${year}-${row.yearless}` } : row) : items;
}
