import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, useColorScheme, useWindowDimensions } from "react-native";
import Svg, { Path } from "react-native-svg";
import { fonts, useColors } from "./ui";

/** Three series that stay apart in dark mode and for colour-blind eyes: checked with the data-viz palette validator. */
export const seriesColors = {
  light: ["#B9851A", "#9A4F36", "#0088A0"],
  dark: ["#B78A1F", "#A4553A", "#1C9A9A"],
} as const;
export function useSeriesColors() { return seriesColors[useColorScheme() === "dark" ? "dark" : "light"]; }

export interface Bar {
  key: string;
  /** "Mon" and "Nov 3". */
  labels: [string, string];
  /** Stacked from the baseline. A single value is a plain bar. */
  values: number[];
  /** What's written on the cap. A day with nothing logged has a dash and no bar: it isn't a zero. */
  cap: string;
  spoken: string;
  partial: boolean;
}

const slotWidth = 44, plot = 88, barWidth = 20, labelScale = 2;
/** A bar with a 4pt rounded top, square at the baseline. */
function barPath(x: number, top: number, bottom: number, rounded: boolean) {
  const r = rounded ? Math.min(4, (bottom - top) / 2, barWidth / 2) : 0, right = x + barWidth;
  return `M${x} ${bottom}V${top + r}${r ? `Q${x} ${top} ${x + r} ${top}` : ""}H${right - r}${r ? `Q${right} ${top} ${right} ${top + r}` : ""}V${bottom}Z`;
}

/** Columns that open their day. Each slot is a 44pt target, or wider with large text, so a long range scrolls rather than shrinking them. */
export function StatBars({ bars, colors, onOpen }: { bars: Bar[]; colors: readonly string[]; onOpen: (key: string) => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), scale = Math.min(fontScale, labelScale),
    [width, setWidth] = useState(0), scroller = useRef<ScrollView>(null),
    least = Math.round(slotWidth * scale), slot = width && width / bars.length > least ? width / bars.length : least,
    capHeight = Math.ceil(18 * scale), height = plot + capHeight + 2,
    most = Math.max(1, ...bars.map((bar) => bar.values.reduce((total, value) => total + value, 0))),
    tall = (value: number) => (value / most) * plot,
    label = { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14, color: c.muted, textAlign: "center" as const };
  const chart = <View style={{ width: slot * bars.length }}>
    <Svg width={slot * bars.length} height={height} style={{ position: "absolute", top: 0, left: 0 }} pointerEvents="none">
      {bars.flatMap((bar, index) => {
        const x = index * slot + (slot - barWidth) / 2, drawn = bar.values.map((value, series) => ({ value, series })).filter(({ value }) => value > 0);
        let bottom = height;
        return drawn.map(({ value, series }, place) => {
          const size = tall(value), gap = place ? 2 : 0, top = bottom - Math.max(3, size);
          const path = barPath(x, top, bottom - gap, place === drawn.length - 1);
          bottom = top;
          return <Path key={`${bar.key}:${series}`} d={path} fill={colors[series]} opacity={bar.partial ? 0.5 : 1} />;
        });
      })}
    </Svg>
    <View style={{ flexDirection: "row" }}>
      {bars.map((bar) => {
        const total = bar.values.reduce((sum, value) => sum + value, 0);
        return <Pressable key={bar.key} accessibilityRole="button" accessibilityLabel={bar.spoken} accessibilityHint="Opens this day" onPress={() => onOpen(bar.key)}
          style={({ pressed }) => ({ width: slot, opacity: pressed ? 0.6 : 1 })}>
          <View style={{ height }}>
            <Text key={fontScale} numberOfLines={1} maxFontSizeMultiplier={labelScale} style={{ position: "absolute", left: 0, right: 0, bottom: tall(total) + 2, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: total ? c.text : c.muted, textAlign: "center", fontVariant: ["tabular-nums"] }}>{bar.cap}</Text>
          </View>
          <View style={{ height: 1, backgroundColor: c.outline }} />
          <View style={{ paddingTop: 4, minHeight: 36 }}>
            {bar.labels.map((text, line) => <Text key={`${line}:${fontScale}`} numberOfLines={1} maxFontSizeMultiplier={labelScale} style={{ ...label, fontVariant: ["tabular-nums"] }}>{text}</Text>)}
          </View>
        </Pressable>;
      })}
    </View>
  </View>;
  return <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} scrollEnabled={slot * bars.length > width} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}>
      {chart}
    </ScrollView>
  </View>;
}

/** A row of proportional segments, for the balance between sides. */
export function SplitBar({ values, colors, label }: { values: number[]; colors: readonly string[]; label: string }) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return <View accessible accessibilityLabel={label} style={{ flexDirection: "row", gap: 2, height: 12 }}>
    {values.map((value, index) => value > 0 && <View key={index} style={{ flex: value / total, borderRadius: 4, backgroundColor: colors[index] }} />)}
  </View>;
}

/** The colour beside a name, since text never wears the data colour. */
export function Legend({ items, colors }: { items: string[]; colors: readonly string[] }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 }}>
    {items.map((item, index) => <View key={item} style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: colors[index] }} />
      <Text key={fontScale} maxFontSizeMultiplier={0} style={{ flexShrink: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 19, color: c.text, fontVariant: ["tabular-nums"] }}>{item}</Text>
    </View>)}
  </View>;
}
