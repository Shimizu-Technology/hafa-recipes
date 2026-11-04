import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { messageFor, type BabyRecord, type Child, type FeedTimer } from "@/lib/models";
import { nextSide } from "@/lib/care-glance";
import { careSummary, friendlyTime } from "@/lib/care-format";
import { clockText, currentSide, feedRecordData, type FeedSide } from "@/lib/feed-timer";
import { finishFeed, logBothSides, runningFeed, startFeed, switchFeed } from "@/lib/running-feed";
import { Icon, PressTarget, easeOut, fonts, radii, tap, typeScale, useColors, useToast, type IconName } from "./ui";
import { useReducedMotion } from "./motion";
import { useSecondClock } from "./feed-timer";

const word = { left: "Left", right: "Right", both: "Both" } as const;
const other = (side: FeedSide): FeedSide => (side === "left" ? "right" : "left");
/** Every night target is at least this tall. */
export const quickTarget = 56;

type Saved = { key: number; label: string; undo?: () => Promise<unknown> };

/** One big choice inside a panel or running card. `strong` marks the suggested one. */
function Option({ label, detail, hint, strong, height = 76, onPress }: { label: string; detail?: string; hint?: string; strong?: boolean; height?: number; onPress: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <PressTarget accessibilityRole="button" accessibilityLabel={detail ? `${label}, ${detail}` : label} accessibilityHint={hint} onPress={onPress}
    style={{ flexGrow: 1, flexBasis: fontScale >= 1.5 ? "100%" : 0, minWidth: 0, minHeight: Math.max(quickTarget, height), borderRadius: 20, paddingVertical: 8, paddingHorizontal: 6,
      alignItems: "center", justifyContent: "center", backgroundColor: strong ? c.action : c.tile }}>
    <Text key={fontScale} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 18, lineHeight: 23, textAlign: "center", color: strong ? c.onAction : c.text }}>{label}</Text>
    {!!detail && <Text key={`d:${fontScale}`} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15, textAlign: "center", color: strong ? c.onAction : c.muted }}>{detail}</Text>}
  </PressTarget>;
}

/** The dock's four tiles, in the thumb's reach just above the tab bar. */
function Tile({ icon, label, hint, primary, open, onPress }: { icon: IconName; label: string; hint: string; primary?: boolean; open?: boolean; onPress: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <PressTarget accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ expanded: !!open }} onPress={onPress}
    style={{ flexGrow: 1, flexBasis: fontScale >= 1.3 ? "45%" : 0, minWidth: 0, minHeight: 76, paddingVertical: 10, paddingHorizontal: 4, borderRadius: radii.tile,
      alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: primary ? c.action : c.surface,
      borderWidth: 2, borderColor: open ? c.accent : "transparent" }}>
    <Icon name={icon} size={24} color={primary ? c.onAction : c.accentText} />
    <Text key={fontScale} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 16, textAlign: "center", color: primary ? c.onAction : c.text }}>{label}</Text>
  </PressTarget>;
}

/** The running feed: side and elapsed time, Switch and Done. Ignoring it is fine; the feed is already saved. */
function RunningCard({ timer, onSwitch, onDone }: { timer: FeedTimer; onSwitch: () => void; onDone: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), now = useSecondClock(true), side = currentSide(timer),
    open = timer.segments[timer.segments.length - 1],
    earlier = timer.segments.slice(0, -1).filter((s) => s.ended_at)
      .map((s) => `${word[s.side]} ${clockText(new Date(s.ended_at!).getTime() - new Date(s.started_at).getTime())}`).join(", "),
    spent = clockText(now.getTime() - new Date(open.started_at).getTime()),
    stacked = fontScale >= 1.3;
  return <View style={{ backgroundColor: c.surface, borderRadius: radii.card, padding: 12, gap: 10 }}>
    <View style={{ flexDirection: stacked ? "column" : "row", alignItems: stacked ? "flex-start" : "flex-end", justifyContent: "space-between", gap: 10, paddingHorizontal: 4 }}>
      {/* Read as one line, and not again every second. */}
      <View accessible accessibilityLabel={`Feeding, ${side} side, started ${friendlyTime(timer.started_at, now)}`} style={{ flexShrink: 0 }}>
        <Text key={`e:${fontScale}`} maxFontSizeMultiplier={0} style={{ ...typeScale.footnote, fontFamily: fonts.semibold, color: c.accentText }}>Feeding</Text>
        <Text key={`t:${fontScale}`} maxFontSizeMultiplier={1.4} numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 34, lineHeight: 40, color: c.text, fontVariant: ["tabular-nums"] }}>{`${word[side]} · ${spent}`}</Text>
      </View>
      <Text key={`c:${fontScale}`} maxFontSizeMultiplier={0} style={{ flexShrink: 1, ...typeScale.caption, color: c.muted, textAlign: stacked ? "left" : "right" }}>
        {earlier || "You can put the phone down. It stays saved."}
      </Text>
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Option label={`Switch to ${word[other(side)]}`} height={64} onPress={onSwitch} />
      <Option label="Done" strong height={64} hint="Records how long this feed took" onPress={onDone} />
    </View>
  </View>;
}

/** What just saved, with Undo. It fades on its own; nothing here needs an answer. */
function SavedRow({ saved, onUndo, onGone }: { saved: Saved; onUndo: () => void; onGone: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), reduced = useReducedMotion(), fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    fade.setValue(1);
    void AccessibilityInfo.isScreenReaderEnabled().then((reader) => {
      if (!active) return;
      if (reader) AccessibilityInfo.announceForAccessibility(`${saved.label} saved.${saved.undo ? " Undo available." : ""}`);
      timer = setTimeout(() => {
        if (reduced) return onGone();
        Animated.timing(fade, { toValue: 0, duration: 240, easing: easeOut, useNativeDriver: true }).start(({ finished }) => { if (finished) onGone(); });
      }, reader ? 20000 : 6000);
    });
    return () => { active = false; if (timer) clearTimeout(timer); fade.stopAnimation(); };
  }, [saved.key]);
  return <Animated.View style={{ opacity: fade, flexDirection: "row", alignItems: "center", gap: 10, minHeight: quickTarget, paddingLeft: 12, borderRadius: radii.toast, backgroundColor: c.surface, borderWidth: 1, borderColor: c.outline }}>
    <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: c.accent }}>
      <Icon name="checkmark" size={17} color={c.onAdd} />
    </View>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text key={`l:${fontScale}`} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 19, color: c.text }}>{saved.label}</Text>
      <Text key={`s:${fontScale}`} maxFontSizeMultiplier={0} style={{ ...typeScale.caption, color: c.muted }}>Saved</Text>
    </View>
    {!!saved.undo && <PressTarget accessibilityRole="button" accessibilityLabel={`Undo ${saved.label}`} onPress={onUndo}
      style={{ minHeight: quickTarget, minWidth: quickTarget, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" }}>
      <Text key={`u:${fontScale}`} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 20, color: c.accentText }}>Undo</Text>
    </PressTarget>}
  </Animated.View>;
}

export function QuickLog({ child, rows, now, legacyTimer, onBottle, onDiaper, sleeping, onSleep }: {
  child: Child;
  rows: BabyRecord[];
  now: Date;
  /** A timer started on an older build is still running; it finishes on its own card first. */
  legacyTimer?: boolean;
  onBottle: () => void;
  onDiaper: () => void;
  sleeping: boolean;
  onSleep: () => void;
}) {
  const b = useBaby(), c = useColors(), toast = useToast(),
    [panel, setPanel] = useState<"breast" | null>(null),
    [saved, setSaved] = useState<Saved | null>(null),
    // A ref, not state, so two taps in the same frame cannot both start a write.
    writing = useRef(false),
    keys = useRef(0),
    running = runningFeed(b.state, child.id, now),
    next = nextSide(rows, child.id),
    last = rows.find((row) => row.kind === "feeding" && row.child_id === child.id && row.data.method === "breast");
  async function save(label: string, action: () => Promise<() => Promise<unknown>>) {
    if (writing.current) return;
    writing.current = true;
    try {
      const undo = await action();
      tap("success");
      setPanel(null);
      setSaved({ key: ++keys.current, label, undo });
    } catch (e) { toast(messageFor(e)); }
    finally { writing.current = false; }
  }
  async function undo() {
    if (!saved?.undo) return;
    const action = saved.undo;
    setSaved(null);
    tap();
    try { await action(); } catch (e) { toast(messageFor(e)); }
  }
  function openBreast() {
    if (legacyTimer) return toast("A feeding timer is running. Finish it from the timer above.");
    tap();
    setPanel(panel === "breast" ? null : "breast");
  }
  function side(choice: FeedSide | "both") {
    if (choice === "both") return save("Both sides", () => logBothSides(b, child.id));
    return save(word[choice], () => startFeed(b, child.id, choice));
  }
  return <View style={{ gap: 8 }}>
    {!!saved && <SavedRow saved={saved} onUndo={() => void undo()} onGone={() => setSaved((current) => (current?.key === saved.key ? null : current))} />}
    {running && <RunningCard timer={running}
      onSwitch={() => void save(`Switched to ${word[other(currentSide(running))]}`, () => switchFeed(b, running))}
      onDone={() => void save(careSummary("feeding", feedRecordData(running), running.started_at), () => finishFeed(b, running))} />}
    {panel === "breast" && <View style={{ backgroundColor: c.surface, borderRadius: radii.card, padding: 12, gap: 10 }}>
      <Text maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 19, color: c.text, paddingHorizontal: 2 }}>
        Which side?{last?.data.side ? <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: c.muted }}>{`  Last: ${word[last.data.side]}, ${friendlyTime(last.occurred_at, now)}`}</Text> : null}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(["left", "right", "both"] as const).map((choice) => <Option key={choice} label={word[choice]} strong={choice === next} detail={choice === next ? "Next" : undefined}
          onPress={() => void side(choice)} />)}
      </View>
    </View>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Tile primary icon="care:mother-nurse" label={running || legacyTimer ? "Feeding" : "Breastfeed"} open={panel === "breast"}
        hint="Choose left, right or both. A tap saves it." onPress={openBreast} />
      <Tile icon="care:baby-bottle-outline" label="Bottle" hint="Log a bottle" onPress={onBottle} />
      <Tile icon="care:human-baby-changing-table" label="Diaper" hint="Choose wet, dirty or both" onPress={onDiaper} />
      <Tile icon={sleeping ? "moon" : "moon-outline"} label={sleeping ? "Wake up" : "Sleep"} hint={sleeping ? "Ends the current sleep now" : "Starts a sleep now"} onPress={onSleep} />
    </View>
  </View>;
}
