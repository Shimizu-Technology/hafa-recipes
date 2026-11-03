import { describe, expect, it } from "vitest";
import { dark, light, type ColorTokens } from "@/constants/theme";
import { getLook, linkLook, lookIds, previewEnabled, restoredLook } from "@/constants/looks";
import { incomingNativePath } from "./native-intent";
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function ratio(a: string, b: string) { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); }
it("keeps Current's exact palette objects and system fonts", () => {
  const look = getLook("current"); expect(look.palette.light).toBe(light); expect(look.palette.dark).toBe(dark); expect(look.fonts.display).toBeUndefined();
});
it("production ignores persisted choices and preview links, including Current", () => {
  expect(previewEnabled("production")).toBe(false);
  for (const value of [...lookIds, "bad", null, ["athletic", "pro"]]) {
    expect(restoredLook(value, false)).toBe("current"); expect(linkLook(value, false)).toBeNull();
  }
  expect(incomingNativePath("hafaworkouts://design-preview?look=athletic")).toBe("/");
});
it("accepts only known single look ids and supports reset", () => {
  for (const id of lookIds) { expect(restoredLook(id, true)).toBe(id); expect(linkLook(id, true)).toBe(id); }
  expect(restoredLook("missing", true)).toBe("current"); expect(linkLook(["pro"], true)).toBeNull();
  expect(incomingNativePath("hafaworkouts://design-preview?look=coach", { designPreview: true })).toBe("/design-preview?look=coach");
});
// All new text / fill combinations, including both ends of the cover gradient.
const textPairs: [keyof ColorTokens, keyof ColorTokens][] = [
  ...(["background", "surface", "elevated", "sunken", "accentSoft", "tabBar", "segment"] as const).flatMap(bg => (["text", "muted"] as const).map(fg => [fg, bg] as [keyof ColorTokens, keyof ColorTokens])),
  ["onAction", "action"], ["onAccent", "accent"], ["onActionSoft", "actionSoft"], ["onHero", "hero"], ["heroMuted", "hero"], ["heroAccent", "hero"],
  ["accentText", "background"], ["accentText", "surface"], ["accentText", "accentSoft"], ["background", "text"],
  ["error", "errorSoft"], ["error", "background"], ["success", "surface"], ["warning", "sunken"],
];
describe.each(["athletic", "coach", "pro"] as const)("%s tokens", id => {
  it.each(["light", "dark"] as const)("passes every introduced text pair in %s", mode => {
    const c = getLook(id).palette[mode];
    for (const [fg, bg] of textPairs) expect(ratio(c[fg], c[bg]), `${id} ${mode}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    for (const bg of [c.background, c.surface, c.elevated]) expect(ratio(c.borderStrong, bg)).toBeGreaterThanOrEqual(3);
    if (id === "coach") expect(ratio(c.borderStrong, c.sunken)).toBeGreaterThanOrEqual(3);
  });
  it("has named font weights, variants and a complete native motion profile", () => {
    const look = getLook(id); expect(look.fonts.regular).toBeTruthy(); expect(look.fonts.display).toBeTruthy();
    expect(look.motion.pressScale).toBeGreaterThanOrEqual(0.96); expect(look.motion.stagger).toBe(40);
    expect(Object.values(look.variants).every(value => value === id)).toBe(true);
    expect(look.palette.dark.background).not.toBe("#000000");
  });
});
