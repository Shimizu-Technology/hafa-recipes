import type { BabyRecord } from "./models";

// Match Python's strip/splitlines/code-point slicing at the idempotent wire
// boundary, including emoji and Unicode separators in shared captions.
export function sharedSourceTitle(text?: string) {
  const blank = "\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
  const stripped = (text ?? "").replace(new RegExp(`^[${blank}]+|[${blank}]+$`, "g"), "");
  return Array.from(stripped.split(/\r\n|[\n\v\f\r\x1c-\x1e\x85\u2028\u2029]/)[0]).slice(0, 100).join("") || "Saved source";
}

/** A readable first sentence, at most 60 code points, ending at a word boundary. */
export function shortSourceTitle(value: string) {
  const text = value.trim().split(/[\r\n\u2028\u2029]/)[0].replace(/\s+/g, " ");
  const sentence = text.match(/^.*?[.!?。！？](?:\s|$)/u)?.[0].trim() || text;
  if (Array.from(sentence).length <= 60) return sentence || "Saved source";
  const prefix = Array.from(sentence).slice(0, 59).join("");
  const boundary = prefix.lastIndexOf(" ");
  return boundary > 0 ? prefix.slice(0, boundary).trimEnd() + "…" : "Saved source";
}
/** Display only: never mutate original share bytes or replace a user-edited title.
 * The server replaces its Saved source placeholder when processing completes. */
export function sourceTitle(record: BabyRecord) {
  const text = record.data.source_text || record.body;
  const originalCapture = record.revision <= 1 && record.title === sharedSourceTitle(text);
  return !record.title.trim() || record.title === "Saved source" || originalCapture
    ? shortSourceTitle(text) : record.title;
}
