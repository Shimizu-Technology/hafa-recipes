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

/** Her words, cut at a space where there is one and never through an emoji, with what would dangle taken off. */
function shortened(text: string, limit: number) {
  const letters = [...text];
  if (letters.length <= limit) return text;
  const room = letters.slice(0, limit - 1).join(""), space = room.lastIndexOf(" ");
  const cut = (space >= limit / 2 ? room.slice(0, space) : room).replace(/[‍️]+$/, "");
  return (cut.replace(/[\s,;:.\-–—(]+$/, "") || cut) + "…";
}

/** What an entry with no title goes by: her first words. The phone makes it, so it works offline and sends nothing anywhere. */
export const firstWords = (body: string) => shortened(firstLineOf(body), shortTitle);

/**
 * Whether a title only says the body's first line again. The API keeps no mark of who wrote a title, so this reads the words:
 * the whole line; `firstWords` now, or the 59 letters and an ellipsis older builds cut; or three words or more that the line
 * opens with, which is what an older build's title became once she added to the line. One or two words can be a title she chose.
 */
export function repeatsBody(title: string, body: string) {
  const heading = oneLine(title), line = firstLineOf(body);
  if (!heading || !line) return false;
  const start = words(heading), whole = words(line);
  if (start === whole) return true;
  if (heading.endsWith("…")) return start.length >= shortestCut && whole.startsWith(start);
  return start.split(" ").length >= 3 && whole.startsWith(`${start} `);
}

/** The title she chose, or nothing when it's only her first line or the kind's name. It's what the editor shows and a row can lean on. */
export function writtenTitle({ kind, title, body }: Pick<BabyRecord, "kind" | "title" | "body">) {
  const heading = title.trim();
  return !heading || heading === kindWord(kind) || repeatsBody(heading, body) ? "" : heading;
}

/**
 * What a journal row says under its title. Under one she chose, the body. Under her first words, what comes after them,
 * so the same words are never listed twice and an entry with more to it says so.
 */
export function journalPreview(row: Pick<BabyRecord, "kind" | "title" | "body">) {
  const body = oneLine(row.body);
  if (!body) return "";
  if (writtenTitle(row)) return shortened(body, 90);
  const start = oneLine(row.title).replace(/…$/, "").trimEnd();
  const rest = body.toLocaleLowerCase().startsWith(start.toLocaleLowerCase()) ? body.slice(start.length).replace(/^[\s.!?,;:]+/, "") : body;
  return shortened(rest, 90);
}
