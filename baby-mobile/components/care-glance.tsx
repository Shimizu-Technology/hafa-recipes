import { useEffect, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import type { BabyRecord, Child } from "@/lib/models";
import { careSummary, duration, timeAgo } from "@/lib/care-format";
import { babyAge, careGlance, nextFeed } from "@/lib/care-glance";
import { Card, Copy, Icon, fonts, useColors, type IconName } from "./ui";
import { kindIcon } from "./record-row";

/** Re-render on a slow clock so "2 h 10 min ago" stays true while Today is open. */
export function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Line({ icon, title, detail, record, prominent = false }: { icon: IconName; title: string; detail?: string; record?: BabyRecord; prominent?: boolean }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  const content = (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "center", minHeight: 44 }}>
      <Icon name={icon} size={22} color={c.accentText} />
      <View style={{ flex: 1, gap: 1 }}>
        {prominent ? <Text key={fontScale} maxFontSizeMultiplier={0} accessibilityRole="header"
          style={{ fontFamily: fonts.bold, fontSize: 34, letterSpacing: -0.6, color: c.text, fontVariant: ["tabular-nums"] }}>{title}</Text>
          : <Copy kind="small" tone="muted">{title}</Copy>}
        {!!detail && (
          <Copy kind="small" tone="muted">
            {detail}
          </Copy>
        )}
      </View>
    </View>
  );
  return record ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, detail].filter(Boolean).join(". ")}
      accessibilityHint="Opens this entry"
      onPress={() => router.push({ pathname: "/record/[id]", params: { id: record.id } })}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {content}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={[title, detail].filter(Boolean).join(". ")}>
      {content}
    </View>
  );
}

const sideName = { left: "left side", right: "right side", both: "both sides" } as const;

/** What a parent checks first: when she last ate, whether she is asleep, and today's diapers. */
export function CareGlance({ child, rows, now }: { child: Child; rows: BabyRecord[]; now: Date }) {
  const glance = careGlance(rows, child.id, now),
    age = babyAge(child, now),
    next = nextFeed(glance.lastFeed).side,
    { total, wet, dirty } = glance.diapers;
  return (
    <Card tone="hero">
      <Copy kind="small" tone="muted">{child.name}{age ? ` · ${age}` : ""}</Copy>
      <Line
        prominent
        icon={kindIcon.feeding}
        record={glance.lastFeed}
        title={glance.lastFeed ? `Last fed ${timeAgo(glance.lastFeed.occurred_at, now)}` : "No feeds logged yet"}
        detail={
          glance.lastFeed
            ? glance.lastFeed.data.method === "breast" && next && next !== "both"
              ? `Next: ${sideName[next]}`
              : careSummary("feeding", glance.lastFeed.data, glance.lastFeed.occurred_at, now)
            : undefined
        }
      />
      <Line
        icon={kindIcon.sleep}
        record={glance.openSleep ?? glance.lastSleep}
        title={
          glance.openSleep
            ? careSummary("sleep", glance.openSleep.data, glance.openSleep.occurred_at, now)
            : glance.lastSleep
              ? `Awake · woke ${timeAgo(glance.lastSleep.data.end_at!, now)}`
              : "No sleep logged yet"
        }
        detail={
          !glance.openSleep && glance.lastSleep
            ? `Last sleep ${duration(
                (new Date(glance.lastSleep.data.end_at!).getTime() - new Date(glance.lastSleep.occurred_at).getTime()) /
                  60_000
              )}`
            : undefined
        }
      />
      <Line
        icon={kindIcon.diaper}
        title={total ? `${total} diaper${total === 1 ? "" : "s"} today` : "No diapers yet today"}
        detail={total ? `${wet} wet · ${dirty} dirty${glance.feeds ? ` · ${glance.feeds} feed${glance.feeds === 1 ? "" : "s"}` : ""}` : undefined}
      />
    </Card>
  );
}
