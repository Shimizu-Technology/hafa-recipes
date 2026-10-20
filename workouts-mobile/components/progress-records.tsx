import { useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
import { spacing } from "@/constants/theme";
import type { ExerciseRecord } from "@/lib/progress-insights";
import { Button, Copy, ListGroup, SectionHeader, useColors } from "./ui";

/** A tiny line of recent bests. Decorative: the row's label carries the meaning for VoiceOver. */
export function Sparkline({ values, width = 72, height = 28 }: { values: number[]; width?: number; height?: number }) {
  const c = useColors();
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), pad = 3;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (values.length - 1);
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - pad * 2));
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <Svg width={width} height={height} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Polyline points={points} fill="none" stroke={c.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r={3} fill={c.accent} />
    </Svg>
  );
}

function trendWords(values: number[]) {
  if (values.length < 2) return "";
  const [first, last] = [values[0], values.at(-1)!];
  return last > first ? "Trending up." : last < first ? "Trending down." : "Holding steady.";
}

/** Personal bests per exercise with a small trend, newest first. Shows five until expanded. */
export function ProgressRecords({ records }: { records: ExerciseRecord[] }) {
  const [all, setAll] = useState(false);
  if (!records.length) return null;
  const shown = all ? records : records.slice(0, 5);
  return (
    <>
      <SectionHeader title="Records" />
      <ListGroup>
        {shown.map((r) => (
          <View key={r.key} accessible accessibilityLabel={`${r.name}. Best ${r.best}. ${r.detail}. ${trendWords(r.trend)}`}
            style={{ minHeight: 56, paddingVertical: spacing.xs, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Copy kind="label" numberOfLines={1}>{r.name}</Copy>
              <Copy kind="small" tone="muted" numberOfLines={1}>{r.detail}</Copy>
            </View>
            <Sparkline values={r.trend} />
            <Copy kind="numericSmall" style={{ fontSize: 17 }}>{r.best}</Copy>
          </View>
        ))}
      </ListGroup>
      {records.length > 5 && (
        <Button title={all ? "Show fewer" : `Show all ${records.length}`} variant="ghost" size="sm" inline onPress={() => setAll(!all)} />
      )}
    </>
  );
}
