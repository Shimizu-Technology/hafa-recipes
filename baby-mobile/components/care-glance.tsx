import { useEffect, useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import type { BabyRecord, Child } from "@/lib/models";
import type { RunningFeed } from "@/lib/feed-reducer";
import { duration, friendlyTime, timeAgo } from "@/lib/care-format";
import { babyAge, careGlance, nextSide } from "@/lib/care-glance";
import { Card, Copy, PressTarget, fonts, typeScale, useColors } from "./ui";

/** Keep elapsed care times current while Today is open. */
export function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const sideWord = { left: "Left", right: "Right", both: "Both sides" } as const;

/** Readable from across a dark room: when she last fed, and which side is next, with no tap. */
export function CareGlance({ child, rows, now, running }: { child: Child; rows: BabyRecord[]; now: Date; running?: RunningFeed }) {
  const c = useColors(), { fontScale } = useWindowDimensions(),
    feed = careGlance(rows, child.id, now).lastFeed,
    next = nextSide(rows, child.id),
    elapsed = feed ? Math.max(0, Math.floor((now.getTime() - new Date(feed.occurred_at).getTime()) / 60_000)) : 0,
    value = elapsed < 60 ? `${elapsed}m` : elapsed < 2880 ? `${Math.floor(elapsed / 60)}h ${elapsed % 60}m` : `${Math.floor(elapsed / 1440)}d`,
    side = running?.segments[running.segments.length - 1]?.side,
    detail = feed ? [
      feed.data.method === "breast" && feed.data.side ? sideWord[feed.data.side]
        : feed.data.method === "bottle" ? "Bottle" : "Feeding",
      feed.data.amount ? `${feed.data.amount} ${feed.data.unit === "oz" ? "oz" : "mL"}` : "",
      feed.data.duration_minutes ? duration(feed.data.duration_minutes) : "",
      friendlyTime(feed.occurred_at, now),
    ].filter(Boolean).join(" · ") : "Log a feed below.",
    stacked = fontScale >= 1.5,
    eyebrow = (text: string) => <Text key={`${text}:${fontScale}`} maxFontSizeMultiplier={0} style={{ ...typeScale.footnote, fontFamily: fonts.semibold, color: c.accentText }}>{text}</Text>;
  const content = <Card tone="hero" style={{ gap: 12, flexDirection: stacked ? "column" : "row", alignItems: stacked ? "stretch" : "center" }}>
    <View style={{ flex: stacked ? undefined : 1, gap: 2, minWidth: 0 }}>
      {eyebrow(side ? "Feeding now" : "Last fed")}
      {side ? <Text key={`now:${fontScale}`} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} maxFontSizeMultiplier={1.4} style={{ ...typeScale.number, color: c.text }}>{sideWord[side]}</Text>
        : feed ? <Text key={`value:${fontScale}`} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} maxFontSizeMultiplier={1.4} style={{ ...typeScale.number, color: c.text }}>
          {!Number.isFinite(elapsed) ? "Time not recorded" : elapsed < 1 ? "Just now" : <>{value} <Text style={{ fontSize: typeScale.footnote.fontSize, color: c.muted }}>ago</Text></>}
        </Text> : <Copy kind="heading">No recent feed</Copy>}
      <Copy numeric kind="small" tone="muted">{side ? `Started ${friendlyTime(running!.started_at, now)}` : detail}</Copy>
    </View>
    {!!next && <View style={{ gap: 2, alignItems: stacked ? "flex-start" : "flex-end", paddingLeft: stacked ? 0 : 14,
      borderLeftWidth: stacked ? 0 : 1, borderLeftColor: c.border }}>
      {eyebrow("Next side")}
      <Text key={`next:${fontScale}`} maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.display, fontSize: 40, lineHeight: 46, color: c.text }}>{sideWord[next]}</Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {(["left", "right"] as const).map((s) => <View key={s} style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center",
          borderWidth: 1.5, borderColor: s === next ? c.addFill : c.outline, backgroundColor: s === next ? c.addFill : "transparent" }}>
          <Text allowFontScaling={false} style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15, color: s === next ? c.onAdd : c.muted }}>{s === "left" ? "L" : "R"}</Text>
        </View>)}
      </View>
    </View>}
  </Card>;
  const spoken = `${side ? `Feeding now, ${side} side, started ${friendlyTime(running!.started_at, now)}.` : feed ? `Last fed ${timeAgo(feed.occurred_at, now)}. ${detail}.` : "No feed logged yet."}${next ? ` Next side ${next}.` : ""}`;
  return feed ? <PressTarget accessibilityRole="button" accessibilityLabel={spoken} accessibilityHint="Opens this feeding entry"
    onPress={() => router.push({ pathname: "/record/[id]", params: { id: feed.id } })}>{content}</PressTarget>
    : <View accessible accessibilityLabel={spoken}>{content}</View>;
}

export function FirstStep({ child, now }: { child?: Child | null; now: Date }) {
  return <Card tone="hero">
    <Copy kind="small" tone="accent">{child?.due_date ? "Looking ahead" : "A little space for your day"}</Copy>
    <Copy numeric={!!child?.due_date} kind="heading">{child?.due_date ? babyAge(child, now) : "Start with a small moment"}</Copy>
    <Copy tone="muted">{child?.due_date ? "Keep your notes, questions and preparations together." : "Save a note, write in your journal, or add a baby profile when you’re ready."}</Copy>
  </Card>;
}
