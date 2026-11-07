/** No provider, inferred year, clinical interpretation or rewriting. Spans cover the original exactly. */
export interface PastedItem { text: string; start: number; end: number; day: string }
export function pasteVisits(original: string): PastedItem[] {
  const starts = [...original.matchAll(/^\s*(\d{4}-\d{2}-\d{2})(?=\s|$)/gm)];
  if (!starts.length) return [{ text: original, start: 0, end: original.length, day: "" }];
  const boundaries = starts.map((match) => ({ start: match.index!, day: match[1] }));
  if (boundaries[0].start > 0) boundaries.unshift({ start: 0, day: "" });
  return boundaries.map((item, index) => {
    const end = boundaries[index + 1]?.start ?? original.length;
    return { text: original.slice(item.start, end), start: item.start, end, day: validDay(item.day) ? item.day : "" };
  });
}
export function validDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
}
