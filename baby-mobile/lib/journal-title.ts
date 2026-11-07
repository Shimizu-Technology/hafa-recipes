import { kindName, kindWord, type BabyRecord } from "./models";
import { titleLimit } from "./text-limits";

/**
 * What a journal entry with no title stores. The API requires a title (`schemas.py`, `min_length=1`), and this is what
 * every reader, older builds included, already treats as no title. So an entry goes by her words only when it's shown:
 * nothing to go stale, nothing to guess at, and no later edit has anything to rewrite.
 */
export const noTitle = kindName.journal;
const shortTitle = 60;
const previewLength = 90;
/** The shortest start a 60-letter cut can leave. Anything shorter ending in "…" is something she typed. */
const shortestCut = 20;
/** More than a title or preview can show, so a very long entry costs a row no more than a short one. */
const enoughToRead = 4000;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const firstLineOf = (body: string) => oneLine(body.trim().slice(0, enoughToRead).split("\n")[0]);
/** Case and closing punctuation don't make them different words. */
const words = (text: string) => oneLine(text).toLocaleLowerCase().replace(/[\s.!?,;:…]+$/, "");

/** Part of the letter before it: a mark, a joiner, a skin tone, a tag, or the rest of a Hangul syllable. */
function extends_(letter: string) {
  if (/\p{M}/u.test(letter)) return true;
  const point = letter.codePointAt(0) ?? 0;
  return point === 0x200d || (point >= 0x1f3fb && point <= 0x1f3ff) || (point >= 0xe0020 && point <= 0xe007f) || (point >= 0x1160 && point <= 0x11ff);
}
const isFlagLetter = (letter: string) => { const point = letter.codePointAt(0) ?? 0; return point >= 0x1f1e6 && point <= 0x1f1ff; };
/** What a reader sees as one letter. Hermes has no `Intl.Segmenter`, so this is the rules a title can meet. */
function graphemes(text: string) {
  const out: string[] = [];
  let flagOpen = false;
  for (const letter of text) {
    const last = out[out.length - 1];
    if (last !== undefined && (extends_(letter) || last.endsWith("‍") || (flagOpen && isFlagLetter(letter)))) {
      out[out.length - 1] = last + letter;
      flagOpen = false;
    } else {
      out.push(letter);
      flagOpen = isFlagLetter(letter);
    }
  }
  return out;
}
/** Her words, cut at a space where there is one and never through a letter, with what would dangle taken off. */
function shortened(text: string, limit: number) {
  const letters = graphemes(text);
  if (letters.length <= limit) return text;
  const kept = letters.slice(0, limit - 1);
  // Long joined emoji can still pass what the API takes for a title, counted its way.
  while ([...kept.join("")].length >= titleLimit) kept.pop();
  const room = kept.join(""), space = room.lastIndexOf(" ");
  const cut = space >= limit / 2 ? room.slice(0, space) : room;
  return (cut.replace(/[\s,;:.\-–—(]+$/, "") || cut) + "…";
}

/** Her first words. Shown for a journal entry with no title, and stored only as a question's title. */
export const firstWords = (body: string) => shortened(firstLineOf(body), shortTitle);

/**
 * Whether a title's words are already on the page, so the screen needn't say them again. This is only about what's shown.
 * Words can't say who wrote a title, so nothing here may change what's stored or sent. The whole first line, or a cut of a
 * line too long to fit. A title that only opens the line can be one she chose.
 */
export function repeatsBody(title: string, body: string) {
  const heading = oneLine(title), line = firstLineOf(body);
  if (!heading || !line) return false;
  const start = words(heading), whole = words(line);
  return start === whole || (heading.endsWith("…") && [...line].length > shortTitle && start.length >= shortestCut && whole.startsWith(start));
}

/** The title to put above the words, if any: not the kind's name, and not the words again. For showing only. */
export function writtenTitle({ kind, title, body }: Pick<BabyRecord, "kind" | "title" | "body">) {
  const heading = title.trim();
  return !heading || heading === kindWord(kind) || repeatsBody(heading, body) ? "" : heading;
}

/** What a journal entry goes by in a list: its stored title, or her first words when it has none. */
export function journalName({ title, body }: Pick<BabyRecord, "title" | "body">) {
  const heading = title.trim();
  return heading && heading !== noTitle ? heading : firstWords(body);
}

/**
 * What a journal row says under its name: the body, leaving out the words the name already said, whoever wrote them.
 * So the same words are never listed twice, and an entry with more to it says so.
 */
export function journalPreview(row: Pick<BabyRecord, "title" | "body">) {
  const text = oneLine(row.body.slice(0, enoughToRead)), name = journalName(row), start = words(name);
  if (!text) return "";
  // "Walk" over "Walked to the park" isn't the same words, unless the name is a cut that may have stopped inside one.
  const cut = name.endsWith("…"), next = text[start.length], follows = cut || !next || /[\s.!?,;:…)]/.test(next);
  if (!start || !follows || !text.toLocaleLowerCase().startsWith(start)) return shortened(text, previewLength);
  let rest = text.slice(start.length);
  // A cut from an older build can have stopped mid-word, and the rest of that word means nothing alone.
  if (cut && /\S/.test(next ?? "") && !/[\s.!?,;:…)]/.test(next ?? "")) {
    const space = rest.indexOf(" ");
    if (space >= 0) rest = rest.slice(space);
  }
  // And one that stopped inside an emoji left the rest of it behind.
  const letters = [...rest.replace(/^[\s.!?,;:…]+/, "")];
  while (letters.length && extends_(letters[0])) letters.shift();
  return shortened(letters.join(""), previewLength);
}
