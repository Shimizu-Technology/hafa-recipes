// Types for the plain-ESM brand geometry used by scripts/render-brand.mjs and lib/theme.test.ts.
type Palette = { bg: string; halo: string; stone: string; stoneDeep: string | null; highlight: string | null; accent: string };
export declare const palettes: { light: Palette; dark: Palette; mono: Palette };
export type Drawing = (palette: Palette) => string;
export declare function conceptA(p: Palette): string;
export declare function conceptB(p: Palette): string;
export declare function conceptC(p: Palette): string;
export declare const concepts: { A: Drawing; B: Drawing; C: Drawing };
export declare function iconSvg(drawing: Drawing, palette: keyof typeof palettes, options?: { mode?: "icon" | "glyph"; scale?: number; size?: number }): string;
export declare function markShapes(drawing: Drawing): unknown[];
