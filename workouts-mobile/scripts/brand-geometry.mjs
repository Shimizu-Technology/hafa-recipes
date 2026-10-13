// Håfa Workouts brand geometry. Single source for every icon, splash, web and
// in-app mark asset. Drawn on the Håfa Recipes icon grid: 1024 canvas, 380px
// halo, 94px tåsa cap with 47px radius, and the same halagi pillar curve.
//
// Palette values are the shared Håfa brand values (see mobile/constants/Colors.ts)
// plus the Workouts sunrise-coral accent. Keep in sync with constants/theme.ts;
// lib/theme.test.ts asserts they match.

export const palettes = {
  light: {
    bg: "#FFF7EC", // Håfa cream
    halo: "#F8EFE3", // Håfa bone
    stone: "#155C52", // Håfa reef
    stoneDeep: "#0F4942",
    highlight: "#8CD8CC",
    accent: "#E8643C", // Workouts sunrise coral
  },
  dark: {
    bg: "#101411",
    halo: "#171D1A",
    stone: "#2F8F83",
    stoneDeep: "#1D6F65",
    highlight: "#8CD8CC",
    accent: "#F07A52",
  },
  // Single-colour glyph: used for iOS tinted, Android themed and favicons.
  mono: { bg: "none", halo: "none", stone: "#FFFFFF", stoneDeep: null, highlight: null, accent: "#FFFFFF" },
};

const pillar = (top) => {
  // Recipes pillar (top y=708) translated so its top edge sits at `top`.
  const d = top - 708;
  const y = (v) => v + d;
  return `M418 ${y(708)}C432 ${y(654)} 592 ${y(654)} 606 ${y(708)}L650 ${y(870)}C657 ${y(898)} 635 ${y(925)} 606 ${y(925)}H418C389 ${y(925)} 367 ${y(898)} 374 ${y(870)}L418 ${y(708)}Z`;
};
const underside = (top) =>
  `M330 ${top}H694C673 ${top + 58} 604 ${top + 100} 512 ${top + 100}C420 ${top + 100} 351 ${top + 58} 330 ${top}Z`;

/** Concept A (chosen): the tåsa cap is the bar of a barbell, with plates on each end. */
export function conceptA(p) {
  const capY = 396;
  return `
  <rect x="140" y="${capY + 27}" width="744" height="40" rx="20" fill="${p.stoneDeep ?? p.stone}"/>
  <rect x="140" y="${capY - 42}" width="50" height="178" rx="25" fill="${p.accent}"/>
  <rect x="200" y="${capY - 84}" width="66" height="262" rx="33" fill="${p.accent}"/>
  <rect x="834" y="${capY - 42}" width="50" height="178" rx="25" fill="${p.accent}"/>
  <rect x="758" y="${capY - 84}" width="66" height="262" rx="33" fill="${p.accent}"/>
  <path d="${pillar(capY + 140)}" fill="${p.stone}"/>
  ${p.stoneDeep ? `<path d="${underside(capY + 68)}" fill="${p.stoneDeep}"/>` : ""}
  <rect x="290" y="${capY}" width="444" height="94" rx="47" fill="${p.stone}"/>`;
}

/** Concept B: the latte stone leaning forward with sideways motion arcs. */
export function conceptB(p) {
  return `
  <g transform="rotate(7 560 600)">
    <path d="${pillar(556)}" fill="${p.stone}"/>
    ${p.stoneDeep ? `<path d="${underside(468)}" fill="${p.stoneDeep}"/>` : ""}
    <rect x="290" y="400" width="444" height="94" rx="47" fill="${p.stone}"/>
    ${p.highlight ? `<path d="M439 567C456 522 568 522 585 567" stroke="${p.highlight}" stroke-width="24" stroke-linecap="round" opacity="0.48"/>` : ""}
  </g>
  <path d="M132 452C178 432 218 430 252 438" stroke="${p.accent}" stroke-width="28" stroke-linecap="round" fill="none"/>
  <path d="M104 556C164 534 222 532 268 542" stroke="${p.stone}" stroke-width="32" stroke-linecap="round" fill="none"/>
  <path d="M150 660C190 642 228 640 262 648" stroke="${p.accent}" stroke-width="28" stroke-linecap="round" fill="none"/>`;
}

/** Concept C: latte-stone kettlebell. Handle springs from the tåsa cap; the pillar is the bell. */
export function conceptC(p) {
  return `
  <path d="M356 476C326 352 384 252 512 252C640 252 698 352 668 476" stroke="${p.accent}" stroke-width="66" stroke-linecap="round" fill="none"/>
  <path d="M398 548H626L698 820C707 855 681 888 644 888H380C343 888 317 855 326 820L398 548Z" fill="${p.stone}"/>
  ${p.stoneDeep ? `<path d="${underside(520)}" fill="${p.stoneDeep}"/>` : ""}
  <rect x="280" y="448" width="464" height="96" rx="48" fill="${p.stone}"/>`;
}

export const concepts = { A: conceptA, B: conceptB, C: conceptC };

/**
 * Full icon document. `mode`:
 *  - "icon": square, opaque background + halo (App Store / iOS light / dark)
 *  - "glyph": transparent background, no halo (iOS dark/tinted, Android foreground/monochrome, in-app)
 * `scale` shrinks the artwork about the centre (Android 66% safe zone, splash).
 */
export function iconSvg(drawing, palette, { mode = "icon", scale = 1, size = 1024 } = {}) {
  const p = palettes[palette];
  const bg = mode === "icon" && p.bg !== "none" ? `<rect width="1024" height="1024" fill="${p.bg}"/>` : "";
  const halo = mode === "icon" && p.halo !== "none" ? `<circle cx="512" cy="512" r="380" fill="${p.halo}"/>` : "";
  const t = scale === 1 ? "" : ` transform="translate(${512 * (1 - scale)} ${512 * (1 - scale)}) scale(${scale})"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024" fill="none">
  <title>Håfa Workouts</title>${bg}${halo}
  <g${t}>${drawing(p)}
  </g>
</svg>
`;
}

/**
 * Mark geometry with colour *roles* instead of colours, for the in-app
 * react-native-svg component (components/brand-mark-shapes.ts is generated from this).
 */
export function markShapes(drawing) {
  const roles = { stone: "stone", stoneDeep: "stoneDeep", accent: "accent", highlight: null, bg: "none", halo: "none" };
  const svg = drawing(roles);
  const shapes = [];
  for (const m of svg.matchAll(/<(rect|path)\s([^>]*?)\/>/g)) {
    const attrs = Object.fromEntries([...m[2].matchAll(/([a-z-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
    const { fill, ...geometry } = attrs;
    shapes.push({ kind: m[1], role: fill, ...Object.fromEntries(Object.entries(geometry).map(([k, v]) => [k, /^-?[0-9.]+$/.test(v) ? Number(v) : v])) });
  }
  return shapes;
}
