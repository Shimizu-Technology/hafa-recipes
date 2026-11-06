/** A family code, on its own. */
export const codeShape = /hfbi_v1\.[A-Za-z0-9_-]{16,}/;
const wholeCode = /^hfbi_v1\.[A-Za-z0-9_-]{16,92}$/;
const address = /^(?:https:\/\/shimizu-technology\.com\/|\/|hafababy:\/\/)join\/([^?#]*)(?:[?#][\s\S]*)?$/;
/** The code in a family link, "" if the link has no real one, or null if this isn't a family link. */
export function joinLink(path: string) {
  const found = path.match(address);
  if (!found) return null;
  const code = found[1].replace(/\/$/, "");
  return wholeCode.test(code) ? code : "";
}
/**
 * The code from a link they tapped. It's a secret, so it comes out of the address before the router sees it: it's never
 * in a route, a param or a log. It waits here through signing in, until Family takes it. Nothing writes it down, so
 * closing the app forgets it, and they tap the link again.
 */
let held: string | null = null;
export const holdJoinLink = (code: string) => { held = code; };
export const hasJoinLink = () => held !== null;
export const takeJoinLink = () => { const code = held; held = null; return code; };
