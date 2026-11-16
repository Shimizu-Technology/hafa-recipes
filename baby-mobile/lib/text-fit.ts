/**
 * How far a line of text may grow with the phone's text size before its longest word is wider than the line and
 * breaks mid-word ("contractio-ns"). A word can't wrap, so past this the text stops growing instead.
 * `0` means no cap is needed: React Native's own meaning for "as far as she's set it". The 0.6 em per letter is
 * the semibold UI face's widest usual run of lowercase letters, a little generous so the word never just fits.
 */
export function wordFitLimit(text: string, lineWidth: number, fontSize = 17) {
  const longest = Math.max(0, ...text.split(/\s+/).map((word) => word.replace(/[^\p{L}\p{N}’']/gu, "").length));
  if (!longest || lineWidth <= 0) return 0;
  const limit = Math.floor((lineWidth / (longest * fontSize * 0.6)) * 20) / 20;
  // iOS stops at about 3.1× at its largest accessibility size, so a cap above that does nothing.
  return limit >= 3.2 ? 0 : Math.max(1, limit);
}
