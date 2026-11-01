import { expect, it } from "vitest";
import { peekAskPill, reportAskScroll, resetAskScroll, setAskPillHidden } from "./ask-pill";

it("collapses while scrolling down, expands on the way up or near the top, and resets per screen", () => {
  resetAskScroll();
  reportAskScroll(100); expect(peekAskPill().collapsed).toBe(true);
  reportAskScroll(104); expect(peekAskPill().collapsed).toBe(true);
  reportAskScroll(60); expect(peekAskPill().collapsed).toBe(false);
  reportAskScroll(300); expect(peekAskPill().collapsed).toBe(true);
  reportAskScroll(10); expect(peekAskPill().collapsed).toBe(false);
  reportAskScroll(300); resetAskScroll(); expect(peekAskPill().collapsed).toBe(false);
});
it("hides while a screen needs the corner", () => {
  setAskPillHidden(true); expect(peekAskPill().hidden).toBe(true);
  setAskPillHidden(false); expect(peekAskPill().hidden).toBe(false);
});
