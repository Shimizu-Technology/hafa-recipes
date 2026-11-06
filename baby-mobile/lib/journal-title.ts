import { kindWord, type BabyRecord } from "./models";

/** The API's limit on a title. */
export const titleLimit = 240;
const shortTitle = 60;
/** The shortest start a 60-letter cut can leave. Anything shorter ending in "…" is something she typed. */
const shortestCut = 20;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const firstLineOf = (body: string) => oneLine(body.trim().split("\n")[0]);
/** Case and closing punctuation don't make them different words. */
const words = (text: string) => oneLine(text).toLocaleLowerCase().replace(/[\s.!?,;:…]+$/, "");

/** A skin tone, a variation selector or a joiner: part of the emoji before it. */
const joins = (letter?: string) => {
  const point = letter?.codePointAt(0) ?? 0;
  return point === 0x200d || point === 0xfe0f || (point >= 0x1f3fb && point <= 0x1f3ff);
};
/** Her words, cut at a space where there is one and never through an emoji, with what would dangle taken off. */
function shortened(text: string, limit: number) {
  const letters = [...text];
  if (letters.length <= limit) return text;
  let end = limit - 1;
  while (end > 0 && (joins(letters[end]) || letters[end - 1] === "‍")) end--;
  const room = letters.slice(0, end).join(""), space = room.lastIndexOf(" ");
  const cut = space >= limit / 2 ? room.slice(0, space) : room;
  return (cut.replace(/[\s,;:.\-–—(]+$/, "") || cut) + "…";
}

/** What an entry with no title goes by: her first words. The phone makes it, so it works offline and sends nothing anywhere. */
export const firstWords = (body: string) => shortened(firstLineOf(body), shortTitle);

/**
 * Whether a title only says the body's first line again: the whole line, `firstWords`, or the 59 letters and an ellipsis older
 * builds cut. The API keeps no mark of who wrote a title, so this reads the words. A title that's only the start of the line
 * stays: "Our first Christmas" over "Our first Christmas was quiet" can be one she chose, and a title is never hers to lose.
 */
export function repeatsBody(title: string, body: string) {
  const heading = oneLine(title), line = firstLineOf(body);
  if (!heading || !line) return false;
  const start = words(heading), whole = words(line);
  return start === whole || (heading.endsWith("…") && start.length >= shortestCut && whole.startsWith(start));
}

/** The title she chose, or nothing when it's only her first line or the kind's name. It's what the editor shows and a row can lean on. */
export function writtenTitle({ kind, title, body }: Pick<BabyRecord, "kind" | "title" | "body">) {
  const heading = title.trim();
  return !heading || heading === kindWord(kind) || repeatsBody(heading, body) ? "" : heading;
}

/**
 * What a journal row says under its title: the body, leaving out the words the title already said, whoever wrote them.
 * So the same words are never listed twice, and an entry with more to it says so.
 */
export function journalPreview({ title, body }: Pick<BabyRecord, "title" | "body">) {
  const text = oneLine(body), start = words(title);
  if (!text) return "";
  if (!start || !text.toLocaleLowerCase().startsWith(start)) return shortened(text, 90);
  const rest = [...text.slice(start.length).replace(/^[\s.!?,;:…]+/, "")];
  while (joins(rest[0])) rest.shift();
  return shortened(rest.join(""), 90);
}
