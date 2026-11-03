import { describe, expect, it } from "vitest";
import { LOOKS, LOOK_IDS, LOOK_STORAGE_KEY, isLookId, lookPreviewEnabled, parseLookLink, resolveLook, topicIndex, uiFace, displayFace,
  type Palette } from "./looks";

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("design preview gate", () => {
  it("is off only for production builds", () => {
    expect(lookPreviewEnabled("production")).toBe(false);
    expect(lookPreviewEnabled("development")).toBe(true);
    expect(lookPreviewEnabled("preview")).toBe(true);
    expect(lookPreviewEnabled(undefined)).toBe(true);
  });
  it("always renders current in production, whatever is stored", () => {
    for (const id of LOOK_IDS) expect(resolveLook(id, false)).toBe("current");
    expect(resolveLook("soft", true)).toBe("soft");
    expect(resolveLook("cookbook", true)).toBe("current");
    expect(resolveLook(null, true)).toBe("current");
    expect(LOOK_STORAGE_KEY).toBe("@hafa/look-preview");
  });
});

describe("deep link", () => {
  it("reads hafababy://design-preview?look=<id> and resets with look=current", () => {
    expect(parseLookLink("hafababy://design-preview?look=soft")).toBe("soft");
    expect(parseLookLink("hafababy://design-preview?look=scrapbook")).toBe("scrapbook");
    expect(parseLookLink("hafababy://design-preview/?look=warm")).toBe("warm");
    expect(parseLookLink("hafababy://design-preview?look=current")).toBe("current");
  });
  it("ignores other links and unknown looks", () => {
    for (const url of ["hafababy://design-preview", "hafababy://design-preview?look=island", "hafababy://oauth-callback?look=soft",
      "https://example.test/design-preview?look=soft", "hafarecipes://design-preview?look=soft", "not a url", "", null, undefined])
      expect(parseLookLink(url)).toBeNull();
  });
});

describe("look tokens", () => {
  it("keeps current identical to main", () => {
    const { light, dark } = LOOKS.current.palette;
    expect([light.background, light.groupedBackground, light.surface, light.tile, light.text, light.muted, light.action, light.onAction,
      light.accentText, light.tabBar, light.headerFill]).toEqual(["#FFFFFF", "#F2F2F7", "#FAF7F4", "#F6EFE9", "#2D2420", "#6E625B", "#5A4740",
      "#F8F3EE", "#8C5443", "#FFFFFF", "rgba(118,118,128,0.12)"]);
    expect([dark.background, dark.surface, dark.text, dark.action, dark.tabBar]).toEqual(["#000000", "#1C1C1E", "#FFFFFF", "#E3C9B8", "#0C0C0C"]);
    // The selected-tab pill and centre Add keep main's colours.
    expect([light.tabIndicator, light.addFill, light.onAdd]).toEqual([light.accentTint, light.action, light.onAction]);
    expect(LOOKS.current.radii).toMatchObject({ hero: 20, card: 14, grouped: 12, row: 12, field: 10, notice: 16, button: 999, toast: 18 });
    expect(LOOKS.current.density).toEqual({ screen: 16, card: 20, section: 20 });
    expect(LOOKS.current.motion).toMatchObject({ pressScale: 0.97, pressOpacity: 0.82, pressInMs: 120, pressOutMs: 160,
      tabIndicator: false, entrance: false, toastExitEaseOut: false });
    expect(LOOKS.current.fonts.system).toBe(true);
    expect(uiFace(LOOKS.current, "semibold")).toEqual({ fontFamily: "System", fontWeight: "600" });
  });
  it("gives every look Kami's sand ground (the splash) and a tinted dark ground, never pure black", () => {
    for (const id of ["soft", "scrapbook", "warm"] as const) {
      expect(LOOKS[id].palette.light.background).toBe("#F8F3EE");
      expect(LOOKS[id].palette.dark.background).toBe("#14110F");
      expect(LOOKS[id].fonts.system).toBe(false);
      expect(LOOKS[id].motion.toastExitEaseOut).toBe(true);
    }
  });
  it("names one font family per weight and no system weights in a look", () => {
    expect(uiFace(LOOKS.soft, "bold")).toEqual({ fontFamily: "DMSans_700Bold" });
    expect(displayFace(LOOKS.soft, true)).toEqual({ fontFamily: "Newsreader_500Medium_Italic" });
    expect(displayFace(LOOKS.warm)).toEqual({ fontFamily: "Fraunces_600SemiBold" });
    expect(LOOKS.scrapbook.fonts.hand).toBe("Caveat_600SemiBold");
  });
  it("keeps every text-on-fill pair at 4.5:1 and the Add icon at 3:1 in light and dark", () => {
    const checks: [keyof Palette, keyof Palette, number][] = [
      ["text", "background", 4.5], ["text", "surface", 4.5], ["text", "hero", 4.5], ["text", "soft", 4.5], ["text", "tile", 4.5],
      ["muted", "background", 4.5], ["muted", "surface", 4.5], ["muted", "hero", 4.5], ["muted", "tile", 4.5],
      ["accentText", "background", 4.5], ["accentText", "surface", 4.5], ["accentText", "hero", 4.5],
      ["onAction", "action", 4.5], ["onAdd", "addFill", 4.5], ["tabInk", "tabBar", 4.5], ["muted", "tabBar", 4.5],
      ["placeholderInk", "placeholder", 4.5], ["text", "placeholder", 4.5], ["background", "text", 4.5],
      ["addFill", "tabBar", 3], ["progressFill", "hero", 3],
    ];
    const failures: string[] = [];
    for (const id of ["soft", "scrapbook", "warm"] as const) for (const mode of ["light", "dark"] as const) {
      const p = LOOKS[id].palette[mode];
      for (const [fg, bg, min] of checks) {
        const ratio = contrast(p[fg] as string, p[bg] as string);
        if (ratio < min) failures.push(`${id} ${mode} ${fg} on ${bg}: ${ratio.toFixed(2)}`);
      }
      for (const topic of p.topics) {
        for (const [fg, min] of [[p.text, 4.5], [topic.ink, 4.5], [p.muted, 4.5]] as const)
          if (contrast(fg, topic.wash) < min) failures.push(`${id} ${mode} ${fg} on wash ${topic.wash}: ${contrast(fg, topic.wash).toFixed(2)}`);
        if (contrast(topic.ink, p.surface) < 4.5) failures.push(`${id} ${mode} topic ink ${topic.ink} on surface`);
      }
    }
    expect(failures).toEqual([]);
  });
  it("maps a topic to the same tint every time", () => {
    expect(topicIndex("Hospital bag", 5)).toBe(topicIndex(" hospital bag ", 5));
    expect(topicIndex("anything", 0)).toBe(0);
    expect(isLookId("warm")).toBe(true);
    expect(isLookId("athletic")).toBe(false);
  });
});
