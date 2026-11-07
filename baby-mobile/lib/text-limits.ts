/** What the API accepts, counted as it counts: by code point, where an ordinary emoji is one and iOS's own limit sees two. */
export const titleLimit = 240;
export const bodyLimit = 100000;

/** How far past a limit this is. UTF-16 units are never fewer than code points, so short text needn't be counted. */
export function overBy(text: string, limit: number) {
  return text.length <= limit ? 0 : Math.max(0, [...text].length - limit);
}
/** Nothing is cut for her: the words stay until she's chosen what to take out. */
export const tooLongWords = (what: string, over: number) =>
  `This ${what} is ${over.toLocaleString("en-US")} character${over === 1 ? "" : "s"} too long to save. Nothing has been cut. Shorten it to save.`;
/** The message for a title and body that won't save, or nothing when they will. */
export function tooLong(title: string, body: string, what = "entry") {
  const titleOver = overBy(title, titleLimit), bodyOver = overBy(body, bodyLimit);
  return bodyOver ? tooLongWords(what, bodyOver) : titleOver ? tooLongWords("title", titleOver) : "";
}
