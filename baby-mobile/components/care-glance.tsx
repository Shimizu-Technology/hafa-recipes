import { useEffect, useState } from "react";
import { Text, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import type { BabyRecord, Child } from "@/lib/models";
import { duration, timeAgo } from "@/lib/care-format";
import { babyAge, careGlance, nextFeed } from "@/lib/care-glance";
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

/** A single readable answer to “when did we last feed?” */
export function CareGlance({ child, rows, now }: { child: Child; rows: BabyRecord[]; now: Date }) {
  const c = useColors(), { fontScale } = useWindowDimensions(),
    feed = careGlance(rows, child.id, now).lastFeed,
    elapsed = feed ? Math.max(0, Math.floor((now.getTime() - new Date(feed.occurred_at).getTime()) / 60_000)) : 0,
    value = elapsed < 60 ? `${elapsed}m` : elapsed < 2880 ? `${Math.floor(elapsed / 60)}h ${elapsed % 60}m` : `${Math.floor(elapsed / 1440)}d`,
    next = nextFeed(feed).side,
    detail = feed ? [
      feed.data.method === "breast" && feed.data.side
        ? { left: "Left side", right: "Right side", both: "Both sides" }[feed.data.side]
        : feed.data.method === "bottle" ? "Bottle" : "Feeding",
      feed.data.amount ? `${feed.data.amount} ${feed.data.unit === "oz" ? "oz" : "mL"}` : "",
      feed.data.duration_minutes ? duration(feed.data.duration_minutes) : "",
      feed.data.method === "breast" && next && next !== "both" ? `Next: ${next}` : "",
    ].filter(Boolean).join(" · ") : "Start a timer or add a past feed below.";
  const content = <Card tone="hero" style={{ gap: 4 }}>
    <Text key={`label:${fontScale}`} maxFontSizeMultiplier={0} style={{ ...typeScale.footnote, fontWeight: "600", color: c.accentText }}>Last fed</Text>
    {feed ? <Text key={`value:${fontScale}`} numberOfLines={1} maxFontSizeMultiplier={1.4}
      style={{ ...typeScale.number, color: c.text }}>
      {value}<Text style={{ fontFamily: fonts.regular, fontWeight: "400", fontSize: 20, lineHeight: 25, color: c.muted }}> ago</Text>
    </Text> : <Copy kind="heading">No recent feed</Copy>}
    <Copy numeric kind="small" tone="muted">{detail}</Copy>
  </Card>;
  return feed ? <PressTarget accessibilityRole="button"
    accessibilityLabel={`Last fed ${timeAgo(feed.occurred_at, now)}. ${detail}`}
    accessibilityHint="Opens this feeding entry"
    onPress={() => router.push({ pathname: "/record/[id]", params: { id: feed.id } })}>{content}</PressTarget> : content;
}

export function FirstStep({ child, now }: { child?: Child | null; now: Date }) {
  return <Card tone="hero">
    <Copy kind="small" tone="accent">{child?.due_date ? "Looking ahead" : "A little space for your day"}</Copy>
    <Copy numeric={!!child?.due_date} kind="heading">{child?.due_date ? babyAge(child, now) : "Start with a small moment"}</Copy>
    <Copy tone="muted">{child?.due_date ? "Keep your notes, questions and preparations together." : "Save a note, write in your journal, or add a baby profile when you’re ready."}</Copy>
  </Card>;
}
