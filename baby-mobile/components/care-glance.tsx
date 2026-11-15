import { useEffect, useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import type { BabyRecord, Child } from "@/lib/models";
import { runningLimit, type RunningFeed } from "../lib/feed-reducer";
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
export function CareGlance({ child, rows, now, running, timeZone, sides = true }: { child: Child; rows: BabyRecord[]; now: Date; running?: RunningFeed; timeZone?: string | null;
  /** Nursing is switched on, so which side is next means something. */
  sides?: boolean }) {
  const c = useColors(), { fontScale } = useWindowDimensions(),
    feed = careGlance(rows, child.id, now, timeZone).lastFeed,
    // Only with nothing running: "Feeding now Right, Next side Right" reads like a contradiction.
    next = running || !sides ? undefined : nextSide(rows, child.id),
    elapsed = feed ? Math.max(0, Math.floor((now.getTime() - new Date(feed.occurred_at).getTime()) / 60_000)) : 0,
    value = elapsed < 60 ? `${elapsed}m` : elapsed < 2880 ? `${Math.floor(elapsed / 60)}h ${elapsed % 60}m` : `${Math.floor(elapsed / 1440)}d`,
    side = running?.segments[running.segments.length - 1]?.side,
    // A feed nobody finished doesn't read as "Feeding now" forever: past the hour it asks, and the card below says how to answer.
    overdue = !!running && now.getTime() - new Date(running.started_at).getTime() >= runningLimit,
    runningFor = running ? duration((now.getTime() - new Date(running.started_at).getTime()) / 60_000) : "",
    detail = feed ? [
      feed.data.method === "breast" && feed.data.side ? sideWord[feed.data.side]
        : feed.data.method === "bottle" ? "Bottle" : "Feeding",
      feed.data.amount ? `${feed.data.amount} ${feed.data.unit === "oz" ? "oz" : "mL"}` : "",
      feed.data.duration_minutes ? duration(feed.data.duration_minutes) : "",
      friendlyTime(feed.occurred_at, now, timeZone),
    ].filter(Boolean).join(" · ") : "Log a feed below.",
    stacked = fontScale >= 1.5,
    eyebrow = (text: string) => <Text key={`${text}:${fontScale}`} maxFontSizeMultiplier={0} style={{ ...typeScale.footnote, fontFamily: fonts.semibold, color: c.accentText }}>{text}</Text>;
  const content = <Card tone="hero" style={{ gap: 12, flexDirection: stacked ? "column" : "row", alignItems: stacked ? "stretch" : "center" }}>
    <View style={{ flex: stacked ? undefined : 1, gap: 2, minWidth: 0 }}>
      {eyebrow(side ? overdue ? "Still feeding?" : "Feeding now" : "Last fed")}
      {side ? <Text key={`now:${fontScale}`} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} maxFontSizeMultiplier={1.4} style={{ ...typeScale.number, color: c.text }}>{sideWord[side]}</Text>
        : feed ? <Text key={`value:${fontScale}`} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} maxFontSizeMultiplier={1.4} style={{ ...typeScale.number, color: c.text }}>
          {!Number.isFinite(elapsed) ? "Time not recorded" : elapsed < 1 ? "Just now" : <>{value} <Text style={{ fontSize: typeScale.footnote.fontSize, color: c.muted }}>ago</Text></>}
        </Text> : <Copy kind="heading">No recent feed</Copy>}
      <Copy numeric kind="small" tone="muted">{side ? `Started ${friendlyTime(running!.started_at, now, timeZone)}${overdue ? ` · ${runningFor} ago` : ""}` : detail}</Copy>
    </View>
    {/* At most half the row, so its caption never squeezes "Last fed" out of sight. */}
    {!!next && <View style={{ gap: 2, alignItems: stacked ? "flex-start" : "flex-end", paddingLeft: stacked ? 0 : 14, flexShrink: 1, maxWidth: stacked ? undefined : "50%",
      borderLeftWidth: stacked ? 0 : 1, borderLeftColor: c.border }}>
      {eyebrow("Next side")}
      <Copy kind="small" tone="muted">Last record only. Follow your care team’s feeding plan.</Copy>
      <Text key={`next:${fontScale}`} maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.display, fontSize: 40, lineHeight: 46, color: c.text }}>{sideWord[next]}</Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {(["left", "right"] as const).map((s) => <View key={s} style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center",
          borderWidth: 1.5, borderColor: s === next ? c.addFill : c.outline, backgroundColor: s === next ? c.addFill : "transparent" }}>
          <Text allowFontScaling={false} style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15, color: s === next ? c.onAdd : c.muted }}>{s === "left" ? "L" : "R"}</Text>
        </View>)}
      </View>
    </View>}
  </Card>;
  const spoken = `${side ? `${overdue ? "Still feeding?" : "Feeding now,"} ${side} side, started ${friendlyTime(running!.started_at, now, timeZone)}${overdue ? `, ${runningFor} ago` : ""}.` : feed ? `Last fed ${timeAgo(feed.occurred_at, now)}. ${detail}.` : "No feed logged yet."}${next ? ` Next side ${next}.` : ""}`;
  // The card names the running feed when there is one, which may not be the newest record (a bottle top-up can be newer).
  const opens = side ? running!.record.id : feed?.id;
  return opens ? <PressTarget accessibilityRole="button" accessibilityLabel={spoken} accessibilityHint="Opens this feeding entry"
    onPress={() => router.push({ pathname: "/record/[id]", params: { id: opens } })}>{content}</PressTarget>
    : <View accessible accessibilityLabel={spoken}>{content}</View>;
}
