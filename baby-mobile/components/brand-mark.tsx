import { useColorScheme, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

// Same geometry as assets/brand/hafa-baby-mark.svg: a latte stone (halagi pillar + tåsa cap)
// cradling a crescent moon, cropped tightly from the 1024 icon grid.
const VIEWBOX = { x: 270, y: 164, width: 484, height: 700 };
const ASPECT = VIEWBOX.width / VIEWBOX.height;
const MOON = "M637.8 398.4A146 146 0 1 1 486 204.7A124 124 0 0 0 637.8 398.4Z";
const PILLAR = "M418 626C432 572 592 572 606 626L650 788C657 816 635 843 606 843H418C389 843 367 816 374 788L418 626Z";
const UNDERSIDE = "M330 554H694C673 612 604 654 512 654C420 654 351 612 330 554Z";

// Sand & Cocoa: cocoa stone with a clay moon; the dark set matches hafa-baby-icon-dark.svg.
const PALETTES = {
  light: { stone: "#6E5A50", stoneDeep: "#5A4740", accent: "#C9907E" },
  dark: { stone: "#CDB8AA", stoneDeep: "#B29C8F", accent: "#E7B7A5" },
} as const;

type BrandMarkProps = {
  /** Rendered height in points; width follows the mark's aspect ratio. */
  size?: number;
  /** Single-colour override (for example on a tinted surface). Defaults to the light/dark brand palette. */
  color?: string;
};

/** The Håfa Baby mark. Follows the system colour scheme unless `color` is given. */
export function BrandMark({ size = 32, color }: BrandMarkProps) {
  const palette = PALETTES[useColorScheme() === "dark" ? "dark" : "light"];
  const stone = color ?? palette.stone;
  const accent = color ?? palette.accent;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Håfa Baby" style={{ width: size * ASPECT, height: size }}>
      <Svg width={size * ASPECT} height={size} viewBox={`${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.width} ${VIEWBOX.height}`}>
        <Path d={MOON} fill={accent} stroke={accent} strokeWidth={14} strokeLinejoin="round" />
        <Circle cx={650} cy={214} r={30} fill={accent} />
        <Path d={PILLAR} fill={stone} />
        {color ? null : <Path d={UNDERSIDE} fill={palette.stoneDeep} />}
        <Rect x={290} y={486} width={444} height={94} rx={47} fill={stone} />
      </Svg>
    </View>
  );
}
