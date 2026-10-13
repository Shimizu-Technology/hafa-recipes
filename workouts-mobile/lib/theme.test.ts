import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { dark, hafa, light, markColors, workouts, type ColorTokens } from "@/constants/theme";
import { markShapes as geometryShapes, concepts, palettes } from "../scripts/brand-geometry.mjs";
import { markShapes } from "@/components/brand-mark-shapes";

const root = new URL("..", import.meta.url).pathname;
const repo = join(root, "..");

function luminance(hex: string) {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
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
    expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(min);
  });
});

describe("raw colours", () => {
  const hex = /#[0-9A-Fa-f]{3,8}\b/;
  const rgb = /\brgba?\(/;
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
    });
  }
  it("only constants/theme.ts may define hex or rgb colours", () => {
    const offenders = ["app", "components", "lib"]
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
    expect(config).toContain(`const cream = "${hafa.cream}"`);
    expect(config).toContain(`const night = "${dark.background}"`);
  });

  it("icon artwork palettes match the theme", () => {
    expect(palettes.light).toMatchObject({ bg: hafa.cream, halo: hafa.bone, ...markColors.light });
    expect(palettes.dark).toMatchObject({ bg: dark.background, ...markColors.dark });
    expect(markColors.light.accent).toBe(workouts.sunrise);
  });

  it("in-app mark is generated from the master geometry", () => {
    expect(markShapes).toEqual(geometryShapes(concepts.A));
  });

  it("website CSS variables mirror the theme", () => {
    const css = readFileSync(join(repo, "workouts-web/src/styles.css"), "utf8");
    const value = (scope: string, name: string) => {
      const start = css.indexOf(scope);
      const body = css.slice(start, css.indexOf("}", start));
      return body.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim().toUpperCase();
    };
    const map: [string, keyof ColorTokens][] = [
      ["bg", "background"],
      ["surface", "surface"],
      ["sunken", "sunken"],
      ["text", "text"],
      ["muted", "muted"],
      ["border", "border"],
      ["border-strong", "borderStrong"],
      ["action", "action"],
      ["on-action", "onAction"],
      ["action-soft", "actionSoft"],
      ["on-action-soft", "onActionSoft"],
      ["accent", "accent"],
      ["accent-text", "accentText"],
      ["accent-soft", "accentSoft"],
      ["hero", "hero"],
      ["on-hero", "onHero"],
      ["hero-muted", "heroMuted"],
      ["error", "error"],
      ["focus", "focus"],
    ];
    for (const [cssName, token] of map) {
      expect(value(":root {", cssName), `light --${cssName}`).toBe(light[token].toUpperCase());
      expect(value("@media (prefers-color-scheme: dark)", cssName), `dark --${cssName}`).toBe(dark[token].toUpperCase());
    }
  });
});
