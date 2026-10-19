import { Platform, Text, useColorScheme, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { markColors, typography } from "@/constants/theme";
import { markShapes, type MarkRole } from "./brand-mark-shapes";
import { useColors } from "./design/foundation";

// Tight crop of the 1024 icon grid around the latte-stone barbell.
const VIEWBOX = { x: 130, y: 300, width: 764, height: 464 };
const ASPECT = VIEWBOX.width / VIEWBOX.height;

/**
 * The Håfa Workouts mark: a latte stone whose tåsa cap is a barbell.
 * `mono` renders a single colour (for use on the hero surface or in tinted contexts).
 */
export function BrandMark({ height = 28, mono }: { height?: number; mono?: string }) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const colors = markColors[scheme];
  const fill = (role: MarkRole) => mono ?? colors[role];
  const shapes = mono ? markShapes.filter((s) => s.role !== "stoneDeep" || s.kind === "rect") : markShapes;
  return (
    <Svg
      width={height * ASPECT}
      height={height}
      viewBox={`${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.width} ${VIEWBOX.height}`}
      {...(Platform.OS === "web"
        ? { "aria-hidden": true }
        : { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const })}
    >
      {shapes.map((s, i) =>
        s.kind === "rect" ? (
          <Rect key={i} x={s.x} y={s.y} width={s.width} height={s.height} rx={s.rx} fill={fill(s.role)} />
        ) : (
          <Path key={i} d={s.d} fill={fill(s.role)} />
        )
      )}
    </Svg>
  );
}

/** Mark + wordmark, for root-tab headers and sign-in. */
/** `fill` lets the lockup take the free width of a header row; iOS can under-measure the wordmark, which then ellipsizes. */
export function BrandLockup({ height = 24, mono, fill }: { height?: number; mono?: string; fill?: boolean }) {
  const c = useColors();
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel="Håfa Workouts"
      style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1, minWidth: 0, flexGrow: fill ? 1 : 0 }}
    >
      <BrandMark height={height} mono={mono} />
      {/* Two sibling texts, not nested ones: iOS measures a nested run with the outer font, so the
          lighter "Workouts" face was truncated. No adjustsFontSizeToFit (it clips on the new architecture);
          cap growth and let only the descriptor ellipsize on very narrow screens. */}
      <View style={{ flexDirection: "row", alignItems: "baseline", flexShrink: 1, minWidth: 0, flexGrow: fill ? 1 : 0 }}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[typography.subheading, { color: mono ?? c.text, letterSpacing: 0 }]}>
          Håfa{" "}
        </Text>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
          style={[typography.subheading, { fontFamily: typography.body.fontFamily, color: mono ?? c.muted, letterSpacing: 0, flexShrink: 1, flexGrow: fill ? 1 : 0 }]}
        >
          Workouts
        </Text>
      </View>
    </View>
  );
}
