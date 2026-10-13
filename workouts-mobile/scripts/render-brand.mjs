#!/usr/bin/env node
// Renders every Håfa Workouts brand asset from scripts/brand-geometry.mjs.
//
//   node scripts/render-brand.mjs            # app + web assets
//   node scripts/render-brand.mjs --concepts # D1 concept sheets in docs/hafa-workouts/design
//
// Requires rsvg-convert (brew install librsvg) and ImageMagick 7 (brew install imagemagick).
// Output is deterministic for a given tool version; commit both SVG sources and PNGs.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { concepts, iconSvg, markShapes, palettes } from "./brand-geometry.mjs";

const mobile = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(mobile, "..");
const tmp = mkdtempSync(join(tmpdir(), "hafa-brand-"));
const CHOSEN = "A";

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });
}
function svgToPng(svg, out, width, height = width) {
  const src = join(tmp, `${Math.random().toString(36).slice(2)}.svg`);
  writeFileSync(src, svg);
  run("rsvg-convert", ["-w", String(width), "-h", String(height), src, "-o", out]);
}
/** Flatten onto a solid colour and drop the alpha channel (App Store icon requirement). */
function flatten(file, color) {
  run("magick", [file, "-background", color, "-alpha", "remove", "-alpha", "off", "-strip", file]);
}
function strip(file) {
  run("magick", [file, "-strip", file]);
}

function renderConcepts() {
  const out = join(repo, "docs/hafa-workouts/design");
  mkdirSync(join(out, "concepts"), { recursive: true });
  const recipes = join(tmp, "recipes.png");
  run("rsvg-convert", ["-w", "180", join(repo, "mobile/assets/brand/hafa-recipes-icon.svg"), "-o", recipes]);
  const sheets = [];
  for (const [name, draw] of Object.entries(concepts)) {
    const rows = [];
    for (const palette of ["light", "dark", "mono"]) {
      const mode = palette === "mono" ? "glyph" : "icon";
      const svg = iconSvg(draw, palette, { mode });
      writeFileSync(join(out, "concepts", `concept-${name}-${palette}.svg`), svg);
      const cells = [];
      for (const size of [256, 180, 60, 29]) {
        const cell = join(tmp, `${name}-${palette}-${size}.png`);
        svgToPng(svg, cell, size);
        if (palette === "mono") {
          // Show the single-colour glyph the way iOS tinted / Android themed icons do.
          run("magick", ["-size", `${size}x${size}`, "xc:#3B4A44", cell, "-composite", cell]);
        }
        // Pad every cell to 276 so sizes line up.
        run("magick", [cell, "-background", "#E9E4DB", "-gravity", "center", "-extent", "276x276", cell]);
        cells.push(cell);
      }
      const row = join(tmp, `${name}-${palette}-row.png`);
      run("magick", [...cells, "+append", row]);
      rows.push(row);
    }
    // Pairing check: Recipes and the concept at home-screen size, side by side.
    const pair = join(tmp, `${name}-pair.png`);
    const mine = join(tmp, `${name}-180.png`);
    svgToPng(iconSvg(draw, "light"), mine, 180);
    run("magick", [recipes, mine, "-background", "#E9E4DB", "-splice", "24x0", "+append", "-gravity", "center", "-extent", "1104x276", pair]);
    const sheet = join(out, `logo-concept-${name}.png`);
    run("magick", [
      ...rows, pair, "-append",
      "-gravity", "northwest", "-background", "#E9E4DB", "-splice", "0x56",
      "-font", join(repo, "workouts-web/public/fonts/dm-sans-bold.ttf"), "-pointsize", "28", "-fill", "#17120E",
      "-annotate", "+16+14", `Concept ${name}: 256 / 180 / 60 / 29 px; light, dark, mono; with Recipes`,
      "-strip", sheet,
    ]);
    sheets.push(sheet);
  }
  run("magick", [...sheets.map((s) => [s, "-resize", "50%"]).flat(), "+append", "-strip", join(out, "logo-concepts.png")]);
  // Normalise to modest PNG8 for the docs.
  for (const s of [...sheets, join(out, "logo-concepts.png")]) run("magick", [s, "+dither", "-colors", "128", `PNG8:${s}`]);
  console.log(`Concept sheets written to ${out}`);
}

function renderAssets() {
  const draw = concepts[CHOSEN];
  const brandDir = join(mobile, "assets/brand");
  const assets = join(mobile, "assets");
  mkdirSync(brandDir, { recursive: true });
  const write = (file, svg) => writeFileSync(join(brandDir, file), svg);

  // Masters (committed as the editable sources).
  const icon = iconSvg(draw, "light");
  const iconDark = iconSvg(draw, "dark");
  const glyphLight = iconSvg(draw, "light", { mode: "glyph" });
  const glyphDark = iconSvg(draw, "dark", { mode: "glyph" });
  const glyphMono = iconSvg(draw, "mono", { mode: "glyph" });
  write("hafa-workouts-icon.svg", icon);
  write("hafa-workouts-icon-dark.svg", iconDark);
  write("hafa-workouts-mark.svg", glyphLight);
  write("hafa-workouts-mark-dark.svg", glyphDark);
  write("hafa-workouts-mark-mono.svg", glyphMono);

  // iOS: light (opaque), dark (transparent glyph — iOS supplies the dark backdrop), tinted (greyscale glyph).
  svgToPng(icon, join(assets, "icon.png"), 1024);
  flatten(join(assets, "icon.png"), palettes.light.bg);
  svgToPng(iconSvg(draw, "dark", { mode: "glyph" }), join(assets, "icon-dark.png"), 1024);
  strip(join(assets, "icon-dark.png"));
  svgToPng(glyphMono, join(assets, "icon-tinted.png"), 1024);
  strip(join(assets, "icon-tinted.png"));

  // Android adaptive: artwork inside the central 66% safe zone.
  svgToPng(iconSvg(draw, "light", { mode: "glyph", scale: 0.78 }), join(assets, "adaptive-foreground.png"), 1024);
  strip(join(assets, "adaptive-foreground.png"));
  svgToPng(iconSvg(draw, "mono", { mode: "glyph", scale: 0.78 }), join(assets, "adaptive-monochrome.png"), 1024);
  strip(join(assets, "adaptive-monochrome.png"));

  // Tight crop around the artwork (same box as components/brand-mark.tsx and the website mark).
  const crop = (svg) => svg.replace('width="1024" height="1024" viewBox="0 0 1024 1024"', 'width="764" height="464" viewBox="130 300 764 464"');

  // Splash: cropped mark so imageWidth (180pt) is the mark's real width.
  svgToPng(crop(glyphLight), join(assets, "splash.png"), 764, 464);
  strip(join(assets, "splash.png"));
  svgToPng(crop(glyphDark), join(assets, "splash-dark.png"), 764, 464);
  strip(join(assets, "splash-dark.png"));

  // Web: mark, favicons, apple-touch and Open Graph image.
  const web = join(repo, "workouts-web/public");
  // Website header mark uses the same tight crop.
  writeFileSync(join(web, "mark.svg"), crop(glyphLight));
  writeFileSync(join(web, "mark-dark.svg"), crop(glyphDark));
  writeFileSync(join(web, "favicon.svg"), iconSvg(draw, "light", { mode: "icon" }));
  for (const size of [16, 32]) {
    svgToPng(iconSvg(draw, "light", { mode: "icon" }), join(web, `favicon-${size}.png`), size);
    strip(join(web, `favicon-${size}.png`));
  }
  svgToPng(icon, join(web, "apple-touch-icon.png"), 180);
  flatten(join(web, "apple-touch-icon.png"), palettes.light.bg);
  // Open Graph card: artwork from SVG, type set by ImageMagick with the bundled DM Sans (OFL).
  const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${palettes.light.bg}"/>
  <circle cx="1000" cy="315" r="300" fill="${palettes.light.halo}"/>
  <g transform="translate(770 66) scale(0.45)">${draw(palettes.light)}</g>
  <rect x="90" y="400" width="96" height="10" rx="5" fill="${palettes.light.accent}"/>
</svg>
`;
  writeFileSync(join(brandDir, "og-image.svg"), og);
  const ogPng = join(web, "og-image.png");
  svgToPng(og, ogPng, 1200, 630);
  const fonts = join(repo, "workouts-web/public/fonts");
  run("magick", [
    ogPng,
    "-font", join(fonts, "dm-sans-bold.ttf"), "-pointsize", "80", "-fill", "#17120E", "-annotate", "+86+268", "Håfa Workouts",
    "-font", join(fonts, "dm-sans-regular.ttf"), "-pointsize", "36", "-fill", "#5E5046", "-annotate", "+90+340", "Save workouts you find. Train your way.",
    "-background", palettes.light.bg, "-alpha", "remove", "-alpha", "off", "-strip", ogPng,
  ]);
  // "Håfa apps" screen: both family icons side by side. Recipes is rendered from its own master SVG.
  svgToPng(iconSvg(draw, "light"), join(brandDir, "hafa-workouts-icon-240.png"), 240);
  flatten(join(brandDir, "hafa-workouts-icon-240.png"), palettes.light.bg);
  run("rsvg-convert", ["-w", "240", "-h", "240", join(repo, "mobile/assets/brand/hafa-recipes-icon.svg"), "-o", join(brandDir, "hafa-recipes-icon-240.png")]);
  flatten(join(brandDir, "hafa-recipes-icon-240.png"), palettes.light.bg);

  // In-app mark geometry (react-native-svg). Generated so it can never drift from the master SVG.
  writeFileSync(
    join(mobile, "components/brand-mark-shapes.ts"),
    `// Generated by scripts/render-brand.mjs from scripts/brand-geometry.mjs. Do not edit.\n` +
      `export type MarkRole = "stone" | "stoneDeep" | "accent";\n` +
      `export type MarkShape =\n  | { kind: "rect"; role: MarkRole; x: number; y: number; width: number; height: number; rx: number }\n  | { kind: "path"; role: MarkRole; d: string };\n` +
      `export const markShapes: MarkShape[] = ${JSON.stringify(markShapes(draw), null, 2)};\n`
  );
  console.log(`Concept ${CHOSEN} assets written.`);
}

try {
  if (process.argv.includes("--concepts")) renderConcepts();
  else renderAssets();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
