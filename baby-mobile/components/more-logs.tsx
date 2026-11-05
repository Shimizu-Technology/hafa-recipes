import { useEffect, useRef } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useBaby } from "@/lib/context";
import { panelTrackers, type Stage, type Tracker } from "@/lib/trackers";
import type { Child } from "@/lib/models";
import { Icon, PressTarget, fonts, radii, typeScale, useColors } from "./ui";
import { useLogFlow } from "./quick-log";
import type { PastDay } from "./quick-time";
import { SavedLog, TrackerPanel } from "./tracker-panel";

/** What the page's top bar covers, as a page is scrolled to a panel. */
const headerClear = 112;

function Tile({ tracker, label = tracker.label, open, onPress }: { tracker: Tracker; label?: string; open: boolean; onPress: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <PressTarget accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={onPress}
    style={{ flexGrow: 1, flexBasis: fontScale >= 2 ? "100%" : fontScale >= 1.3 ? "45%" : "30%", minWidth: 0, minHeight: 64, paddingVertical: 8, paddingHorizontal: 4, borderRadius: radii.tile,
      alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: c.surface, borderWidth: 2, borderColor: open ? c.accent : "transparent" }}>
    <Icon name={tracker.icon} size={20} color={c.accentText} />
    <Text key={fontScale} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 16, textAlign: "center", color: c.text }}>{label}</Text>
  </PressTarget>;
}

/** A stage's trackers that have their own panel, as tiles. J5 decides which of these belong on Today, from the same list. */
export function MoreLogs({ child, now, pastDay, stage, onOpen }: { child: Child; now: Date; pastDay?: PastDay; stage: Stage;
  /** A panel opened or closed, with where this sits on the page, so the page can bring it into view. */
  onOpen?: (open: boolean, y: number) => void }) {
  const b = useBaby(), c = useColors(), { fontScale } = useWindowDimensions(), shown = panelTrackers(stage),
    flow = useLogFlow<string>(pastDay), top = useRef(0), open = shown.find((tracker) => tracker.id === flow.panel);
  useEffect(() => { onOpen?.(!!open, Math.max(0, top.current - headerClear)); }, [open?.id]);
  return <View onLayout={(event) => { top.current = event.nativeEvent.layout.y; }} style={{ gap: 8 }}>
    <Text key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.footnote, fontFamily: fonts.semibold, color: c.muted }}>More to log</Text>
    <SavedLog flow={flow} now={now} day={pastDay} timeZone={b.state.bootstrap!.profile.timezone} />
    {open && <TrackerPanel tracker={open} child={child} now={now} pastDay={pastDay} flow={flow} />}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {shown.map((tracker) => <Tile key={tracker.id} tracker={tracker} open={open === tracker} onPress={() => flow.toggle(tracker.id)} />)}
    </View>
  </View>;
}
