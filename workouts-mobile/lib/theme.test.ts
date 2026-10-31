import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dark, hafa, light, markColors, workouts, typography, type ColorTokens } from "@/constants/theme";
import { markShapes as geometryShapes, concepts, palettes } from "../scripts/brand-geometry.mjs";
import { markShapes } from "@/components/brand-mark-shapes";

const root = fileURLToPath(new URL("..", import.meta.url));
const repo = join(root, "..");

function rgb(value: string, behind = [255, 255, 255]): number[] {
  if (value.startsWith("#")) return [0, 2, 4].map(i => parseInt(value.slice(i + 1, i + 3), 16));
  const [r, g, b, alpha = 1] = value.match(/[\d.]+/g)!.map(Number);
  return [r, g, b].map((v, i) => v * alpha + behind[i] * (1 - alpha));
}
function luminance(values: number[]) {
  const [r, g, b] = values.map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string, page: string) {
  const bg = rgb(b, rgb(page));
  const [hi, lo] = [luminance(rgb(a, bg)), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Every foreground/background pair the components actually render.
// 4.5 = WCAG AA body text; 3 = large text, icons and control boundaries.
type Pair = [fg: keyof ColorTokens, bg: keyof ColorTokens, min: number];
const pairs: Pair[] = [
  ["text", "background", 4.5],
  ["text", "surface", 4.5],
  ["text", "elevated", 4.5],
  ["text", "sunken", 4.5],
  ["muted", "background", 4.5],
  ["muted", "surface", 4.5],
  ["muted", "elevated", 4.5],
  ["muted", "sunken", 4.5],
  ["onAction", "action", 4.5],
  ["onActionSoft", "actionSoft", 4.5],
  ["onActionSoft", "background", 4.5],
  ["onActionSoft", "surface", 4.5],
  ["accentText", "background", 4.5],
  ["accentText", "surface", 4.5],
  ["accentText", "accentSoft", 4.5],
  ["onAccent", "accent", 4.5],
  ["onHero", "hero", 4.5],
  ["heroMuted", "hero", 4.5],
  ["heroAccent", "hero", 4.5],
  ["error", "background", 4.5],
  ["error", "surface", 4.5],
  ["error", "errorSoft", 4.5],
  ["success", "surface", 4.5],
  ["success", "sunken", 4.5],
  ["warning", "surface", 4.5],
  ["warning", "sunken", 4.5],
  ["background", "text", 4.5], // toast
  ["accent", "background", 3], // rings, today marker, active tab pill icon
  ["accent", "surface", 3],
  ["action", "background", 3], // check badges, selected borders
  ["borderStrong", "surface", 3], // input / chip boundaries
  ["borderStrong", "elevated", 3],
  ["focus", "elevated", 3],
  ["muted", "accentSoft", 4.5], // stat tile label on accent tone
  ["accentText", "surface", 4.5], // active tab label on tab bar
];

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("%s theme", (_, c) => {
  it.each(pairs)("%s on %s meets %s:1", (fg, bg, min) => {
    expect(contrast(c[fg], c[bg], c.background)).toBeGreaterThanOrEqual(min);
  });
});

describe("raw colours", () => {
  const hex = /#[0-9A-Fa-f]{3,8}\b/;
  const rgb = /\b(rgba?|hsla?)\(|["'](white|black)["']/;
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
    });
  }
  it("only constants/theme.ts may define hex or rgb colours", () => {
    const offenders = ["app", "components", "lib", "modules", "plugins"]
      .filter((dir) => { try { return statSync(join(root, dir)).isDirectory(); } catch { return false; } })
      .flatMap((dir) => files(join(root, dir)))
      .filter((path) => !path.endsWith(".test.ts"))
      .flatMap((path) =>
        readFileSync(path, "utf8")
          .split("\n")
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => hex.test(line) || rgb.test(line))
          .map(({ i }) => `${relative(root, path)}:${i + 1}`)
      );
    expect(offenders).toEqual([]);
  });
});

describe("one Håfa family", () => {
  it("shares the exact Håfa values with Recipes", () => {
    const source = readFileSync(join(repo, "mobile/constants/Colors.ts"), "utf8");
    const block = source.slice(source.indexOf("export const brand = {"), source.indexOf("} as const;"));
    const recipes = Object.fromEntries([...block.matchAll(/(\w+):\s*'(#[0-9A-Fa-f]{6})'/g)].map(([, k, v]) => [k, v]));
    for (const [name, value] of Object.entries(hafa)) {
      expect(recipes[name], `brand.${name}`).toBe(value);
    }
  });

  it("app config backgrounds match the theme", () => {
    const config = readFileSync(join(root, "app.config.ts"), "utf8");
    expect(config).toContain(`const cream = "${light.background}"`);
    expect(config).toContain(`const night = "${dark.background}"`);
  });

  it("icon artwork palettes match the theme", () => {
    expect(palettes.light).toMatchObject({ bg: hafa.cream, halo: hafa.bone, ...markColors.light });
    expect(palettes.dark).toMatchObject({ bg: "#101411", ...markColors.dark });
    expect(markColors.light.accent).toBe(workouts.sunrise);
  });

  it("in-app mark is generated from the master geometry", () => {
    expect(markShapes).toEqual(geometryShapes(concepts.A));
  });

  it("uses neutral pages and coral actions independently of the website artwork", () => {
    expect([light.background, dark.background]).toEqual(["#FFFFFF", "#000000"]);
    expect([light.action, dark.action]).toEqual(["#C8471C", "#FF7A50"]);
    expect([light.hero, dark.hero]).toEqual([light.surface, dark.surface]);
  });
  it("uses system UI type with explicit line heights and weights", () => {
    for (const style of Object.values(typography)) {
      expect(style.fontFamily).toBeUndefined();
      expect(style.lineHeight).toBeGreaterThan(style.fontSize);
      expect(style.fontWeight).toMatch(/400|600|700/);
    }
    expect(typography.cardTitle).toMatchObject({ fontSize: 15, lineHeight: 20, fontWeight: "600" });
  });
});
