import { useState } from "react";
import { View, useWindowDimensions } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import { curve, lastMonth, percentileLines, plottedIn, type ChartSex, type ChartUnit, type GrowthPoint, type Measure } from "@/lib/growth-chart";
import { fonts, useColors } from "./ui";

/** The lines drawn. CDC prints nine, which run together at this size; every one still counts in the words beside the chart. */
const drawn = [2, 10, 25, 50, 75, 90, 98] as const satisfies readonly (typeof percentileLines)[number][];
/** Enough room for a newborn's first dots to spread out; it widens as she grows. */
const spans = [6, 12, lastMonth];
const niceStep = (range: number) => {
  const raw = range / 4, power = 10 ** Math.floor(Math.log10(raw)), scaled = raw / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
};

/** CDC's percentile lines with her dots on them. One quiet colour for every line and no zones: nothing here reads a dot. */
export function GrowthChart({ sex, measure, unit, points, label }: { sex: ChartSex; measure: Measure; unit: ChartUnit; points: readonly GrowthPoint[]; label: string }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), [width, setWidth] = useState(0),
    text = 11 * Math.min(fontScale, 1.6), height = Math.round(280 * Math.min(fontScale, 1.3)),
    left = text * 3, right = text * 2.2, top = 10, bottom = text * 3,
    plotted = points.filter((point) => point.onChart),
    span = spans.find((months) => plotted.every((point) => point.months <= months)) ?? lastMonth,
    lines = drawn.map((line) => ({ line, values: curve(sex, measure, line, unit).filter((one) => one.months <= span) })),
    // A dot beyond the lines widens the chart rather than falling off it.
    dots = plotted.map((point) => plottedIn(point, unit)),
    low = Math.min(...lines[0].values.map((one) => one.value), ...dots), high = Math.max(...lines[lines.length - 1].values.map((one) => one.value), ...dots),
    step = niceStep(high - low), floor = Math.floor(low / step) * step, ceiling = Math.ceil(high / step) * step,
    x = (months: number) => left + (months / span) * Math.max(width - left - right, 1),
    y = (value: number) => top + (1 - (value - floor) / (ceiling - floor)) * (height - top - bottom),
    ticks = Array.from({ length: Math.round((ceiling - floor) / step) + 1 }, (_, index) => floor + index * step),
    months = Array.from({ length: span / (span === 6 ? 1 : span === 12 ? 3 : 6) + 1 }, (_, index) => index * (span === 6 ? 1 : span === 12 ? 3 : 6)),
    path = (values: { months: number; value: number }[]) => values.map((one, index) => `${index ? "L" : "M"}${x(one.months).toFixed(1)} ${y(one.value).toFixed(1)}`).join(" ");
  return <View accessible accessibilityRole="image" accessibilityLabel={label} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ height }}>
    {width > 0 && <Svg width={width} height={height}>
      {ticks.map((tick) => <Line key={tick} x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke={c.outline} strokeWidth={0.5} />)}
      {ticks.map((tick) => <SvgText key={`t${tick}`} x={left - 6} y={y(tick) + text / 3} fontSize={text} fontFamily={fonts.regular} fill={c.muted} textAnchor="end">{String(Math.round(tick * 10) / 10)}</SvgText>)}
      {months.map((month) => <SvgText key={month} x={x(month)} y={height - bottom + text * 1.4} fontSize={text} fontFamily={fonts.regular} fill={c.muted} textAnchor="middle">{String(month)}</SvgText>)}
      <SvgText x={left + (width - left - right) / 2} y={height - text * 0.3} fontSize={text} fontFamily={fonts.regular} fill={c.muted} textAnchor="middle">{`Age in months · ${unit === "lb" ? "pounds" : unit === "kg" ? "kilograms" : unit === "in" ? "inches" : "centimeters"}`}</SvgText>
      {lines.map(({ line, values }) => <Path key={line} d={path(values)} fill="none" stroke={c.muted} strokeWidth={line === 50 ? 1.5 : 0.75} opacity={line === 50 ? 0.9 : 0.6} />)}
      {lines.map(({ line, values }) => <SvgText key={`l${line}`} x={width - right + 4} y={y(values[values.length - 1].value) + text / 3} fontSize={text * 0.9} fontFamily={fonts.regular} fill={c.muted}>{String(line)}</SvgText>)}
      {plotted.length > 1 && <Path d={path(plotted.map((point) => ({ months: point.months, value: plottedIn(point, unit) })))} fill="none" stroke={c.accent} strokeWidth={2} />}
      {plotted.map((point) => <Circle key={point.record.id} cx={x(point.months)} cy={y(plottedIn(point, unit))} r={4.5} fill={c.accent} stroke={c.surface} strokeWidth={1.5} />)}
    </Svg>}
  </View>;
}
