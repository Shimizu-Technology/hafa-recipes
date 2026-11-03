import { useEffect, useRef, useState } from "react";
import { Animated, Text, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { BabyRecord, Child } from "@/lib/models";
import { useBaby } from "@/lib/context";
import { useLook, useLookColors } from "@/lib/look-context";
import { displayFace, uiFace, type Look } from "@/lib/looks";
import { dueLine, pregnancyProgress, tipTopic } from "@/lib/timing";
import { sourceTitle } from "@/lib/source-title";
import { Icon, PressTarget, cardEdge } from "@/components/ui";
import { TipSection } from "@/components/tips";
import { EASE_OUT, Entrance, FadeUp, reduceMotion } from "./motion";
import { Placeholder, Tape, safeThumbnail, topicIcon, useTopicTint } from "./bits";

const TOTAL_WEEKS = 40;
type Progress = { week: number; day: number; daysLeft: number };
type Palette = ReturnType<typeof useLookColors>;

/** "Week 34" with "Day 5" beside it while it fits, or on its own line (never a line that starts with a dot). */
function WeekLine({ progress, look, c, size, italicDay = false }: { progress: Progress; look: Look; c: Palette; size: number; italicDay?: boolean }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 10 }}>
    <Text maxFontSizeMultiplier={1.5} style={{ ...displayFace(look), fontSize: size, lineHeight: Math.round(size * 1.12), color: c.text, fontVariant: ["tabular-nums"] }}>
      Week {progress.week}
    </Text>
    <Text maxFontSizeMultiplier={1.5} style={{ ...(italicDay ? displayFace(look, true) : uiFace(look, "medium")), fontSize: Math.round(size * 0.42),
      lineHeight: Math.round(size * 0.56), color: c.muted }}>Day {progress.day}</Text>
  </View>;
}
function Small({ look, c, children, tone = "muted", weight = "regular" }: { look: Look; c: Palette; children: React.ReactNode; tone?: "muted" | "text" | "accent"; weight?: "regular" | "medium" | "semibold" }) {
  return <Text maxFontSizeMultiplier={2.2} style={{ ...uiFace(look, weight), fontSize: 14, lineHeight: 19,
    color: tone === "text" ? c.text : tone === "accent" ? c.accentText : c.muted }}>{children}</Text>;
}
function SeeAll({ look, c, label }: { look: Look; c: Palette; label: string }) {
  return <PressTarget accessibilityRole="link" accessibilityLabel={`See all, ${label}`} hitSlop={8}
    onPress={() => router.navigate({ pathname: "/library", params: { view: "now", at: String(Date.now()) } })}
    style={{ minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" }}>
    <Text maxFontSizeMultiplier={2} style={{ ...uiFace(look, "semibold"), fontSize: 15, lineHeight: 20, color: c.accentText }}>See all</Text>
  </PressTarget>;
}
function SectionTitle({ look, c, title, action }: { look: Look; c: Palette; title: string; action?: React.ReactNode }) {
  return <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
    <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={{ ...displayFace(look), fontSize: look.text.heading.size, lineHeight: look.text.heading.line, color: c.text, flexShrink: 1 }}>{title}</Text>
    {action}
  </View>;
}
const open = (row: BabyRecord) => router.push({ pathname: "/record/[id]", params: { id: row.id } });

/** A saved tip as a compact row inside a hero: thumbnail (or the look's stand-in), title, topic. */
function MiniTip({ row, look, c, topic }: { row: BabyRecord; look: Look; c: Palette; topic: string }) {
  const thumb = safeThumbnail(row), [broken, setBroken] = useState(false), title = sourceTitle(row), { fontScale } = useWindowDimensions();
  return <PressTarget accessibilityRole="button" accessibilityLabel={[title, topic].filter(Boolean).join(". ")} onPress={() => open(row)}
    style={{ flexDirection: fontScale >= 2 ? "column" : "row", alignItems: fontScale >= 2 ? "flex-start" : "center", gap: 12, minHeight: 56, paddingVertical: 6 }}>
    <View style={{ width: 48, height: 48, borderRadius: look.radii.thumb, overflow: "hidden", backgroundColor: c.placeholder }}>
      {/* Inside the blush hero the stand-in tile sits on the card surface so it never melts into the hero. */}
      <Placeholder record={row} size={48} mark={null} fill={look.variants.placeholder === "monogram" ? c.surface : undefined} />
      {thumb && !broken && <Image source={{ uri: thumb }} style={{ position: "absolute", width: 48, height: 48 }} contentFit="cover"
        cachePolicy="memory" transition={150} onError={() => setBroken(true)} />}
    </View>
    <View style={{ flex: fontScale >= 2 ? undefined : 1, gap: 2 }}>
      <Text numberOfLines={fontScale >= 1.3 ? undefined : 2} maxFontSizeMultiplier={2.2}
        style={{ ...uiFace(look, "semibold"), fontSize: 16, lineHeight: 21, color: c.text }}>{title}</Text>
      {!!topic && <Small look={look} c={c}>{topic}</Small>}
    </View>
    {fontScale < 2 && <Icon name="chevron-forward" size={16} color={c.muted} />}
  </PressTarget>;
}

/** Soft: one blush hero holds the week, a soft 34-of-40 bar, the due date and the tips she saved for this week. */
function SoftMoment({ progress, due, tips }: { progress: Progress; due: string; tips: BabyRecord[] }) {
  const { look } = useLook(), c = useLookColors(), collections = useBaby().records.filter((r) => r.kind === "collection");
  const fraction = Math.min(1, (progress.week + progress.day / 7) / TOTAL_WEEKS);
  return <FadeUp durationMs={320} offset={14}>
    <View style={{ backgroundColor: c.hero, borderRadius: look.radii.hero, padding: 22, gap: 16 }}>
      <View accessible accessibilityLabel={`Week ${progress.week}, day ${progress.day} of 40. ${due}`} style={{ gap: 12 }}>
        <WeekLine progress={progress} look={look} c={c} size={52} italicDay />
        <View style={{ height: 8, borderRadius: 4, backgroundColor: c.progressTrack, overflow: "hidden" }}>
          <View style={{ width: `${fraction * 100}%`, height: 8, borderRadius: 4, backgroundColor: c.progressFill }} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: 12 }}>
          <Small look={look} c={c} tone="text" weight="medium">{due}</Small>
          <Small look={look} c={c}>{progress.week} of 40 weeks</Small>
        </View>
      </View>
      <View style={{ height: 1, backgroundColor: c.border }} />
      <View style={{ gap: 4 }}>
        <SectionTitle look={look} c={c} title={`Saved for week ${progress.week}`} action={tips.length ? <SeeAll look={look} c={c} label="For now" /> : undefined} />
        {tips.length ? tips.slice(0, 3).map((row) => <MiniTip key={row.id} row={row} look={look} c={c} topic={tipTopic(row, collections)} />)
          : <Small look={look} c={c}>Tips you save for this point in your pregnancy show up here.</Small>}
      </View>
    </View>
  </FadeUp>;
}

/** Scrapbook: a taped keepsake page with a tape-measure of the 40 weeks, then her pinned tips as clippings. */
function ScrapbookMoment({ progress, due, tips }: { progress: Progress; due: string; tips: BabyRecord[] }) {
  const { look } = useLook(), c = useLookColors(), collections = useBaby().records.filter((r) => r.kind === "collection"),
    [ruler, setRuler] = useState(0), weeksLeft = Math.max(0, Math.ceil(progress.daysLeft / 7));
  const tape = c.topics[2]?.fill ?? c.progressTrack;
  return <>
    <View style={{ marginTop: 8 }}>
      <View style={{ backgroundColor: c.surface, borderRadius: look.radii.hero, padding: 20, paddingTop: 24, gap: 12, ...cardEdge(c.cardBorder, look) }}>
        <View accessible accessibilityLabel={`Week ${progress.week}, day ${progress.day} of 40. ${due}`} style={{ gap: 10 }}>
          <WeekLine progress={progress} look={look} c={c} size={44} />
          {!!look.fonts.hand && weeksLeft > 0 && <Text maxFontSizeMultiplier={1.4} style={{ fontFamily: look.fonts.hand, fontSize: 26, lineHeight: 30, color: c.accentText, marginTop: -4 }}>
            about {weeksLeft} weeks to go ♡</Text>}
          {/* A tape measure: one tick per week, the filled part is how far along she is. */}
          <View onLayout={(e) => setRuler(e.nativeEvent.layout.width)} style={{ height: 30, marginTop: 4 }}>
            {ruler > 0 && <Svg width={ruler} height={30}>
              <Line x1={0} y1={8} x2={ruler} y2={8} stroke={c.soft} strokeWidth={16} />
              <Line x1={0} y1={8} x2={2 + (progress.week / TOTAL_WEEKS) * (ruler - 4)} y2={8} stroke={tape} strokeWidth={16} />
              {Array.from({ length: TOTAL_WEEKS + 1 }, (_, week) => {
                const x = 2 + (week / TOTAL_WEEKS) * (ruler - 4), long = week % 5 === 0, done = week <= progress.week;
                return <Line key={week} x1={x} y1={0} x2={x} y2={long ? 14 : 8} stroke={done ? c.text : c.muted} strokeOpacity={done ? 0.9 : 0.45} strokeWidth={long ? 1.6 : 1} />;
              })}
              <Circle cx={2 + (progress.week / TOTAL_WEEKS) * (ruler - 4)} cy={24} r={5} fill={c.accentText} />
            </Svg>}
          </View>
          <Small look={look} c={c} tone="text" weight="medium">{due}</Small>
        </View>
      </View>
      <View pointerEvents="none" style={{ position: "absolute", top: -6, left: 26, width: 70, height: 18, borderRadius: 2, backgroundColor: tape, opacity: 0.85, transform: [{ rotate: "-5deg" }] }} />
      <View pointerEvents="none" style={{ position: "absolute", top: -4, right: 30, width: 54, height: 16, borderRadius: 2, backgroundColor: c.topics[0]?.fill ?? tape, opacity: 0.7, transform: [{ rotate: "4deg" }] }} />
    </View>
    <View style={{ gap: 14 }}>
      <SectionTitle look={look} c={c} title="Pinned for now" action={tips.length ? <SeeAll look={look} c={c} label="For now" /> : undefined} />
      {tips.length ? tips.slice(0, 3).map((row, index) => {
        const topic = tipTopic(row, collections);
        // Pinned clippings sit a little askew (±1.5° at most); everything else in the app stays straight.
        return <Entrance key={row.id} index={index} born={Date.now()}>
          <View style={{ transform: [{ rotate: ["-1.2deg", "0.9deg", "-0.6deg"][index % 3] }], marginHorizontal: 2 }}>
            <View style={{ backgroundColor: c.surface, borderRadius: look.radii.card, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10, ...cardEdge(c.cardBorder, look) }}>
              <MiniTip row={row} look={look} c={c} topic={topic} />
            </View>
            <Tape topic={topic} index={index} />
          </View>
        </Entrance>;
      }) : <Small look={look} c={c}>Tips you save for this point in your pregnancy show up here.</Small>}
    </View>
  </>;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
/** Warm: the progress arc sweeps once (800ms, strong ease-out) to 34 of 40 weeks. */
function ProgressArc({ fraction, size, c, look, week }: { fraction: number; size: number; c: Palette; look: Look; week: number }) {
  const stroke = 10, r = (size - stroke) / 2, length = 2 * Math.PI * r, sweep = useRef(new Animated.Value(reduceMotion() ? fraction : 0)).current;
  useEffect(() => {
    if (reduceMotion()) return;
    Animated.timing(sweep, { toValue: fraction, duration: 850, delay: 120, easing: EASE_OUT, useNativeDriver: false }).start();
  }, []);
  return <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
    <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.progressTrack} strokeWidth={stroke} fill="none" />
      <AnimatedCircle cx={size / 2} cy={size / 2} r={r} stroke={c.progressFill} strokeWidth={stroke} fill="none" strokeLinecap="round"
        strokeDasharray={`${length} ${length}`} strokeDashoffset={sweep.interpolate({ inputRange: [0, 1], outputRange: [length, 0] })} />
    </Svg>
    <Text allowFontScaling={false} style={{ ...displayFace(look), fontSize: size * 0.3, lineHeight: size * 0.36, color: c.text, fontVariant: ["tabular-nums"] }}>{week}</Text>
    <Text allowFontScaling={false} style={{ ...uiFace(look, "medium"), fontSize: 12, lineHeight: 15, color: c.muted }}>of 40 weeks</Text>
  </View>;
}
function greeting(now: Date) {
  const hour = now.getHours();
  return hour < 5 ? "Hello" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}
/** Two topic cards at most, so no more than two tints share the screen; icon and label always shown. */
function TopicCard({ topic, count, index, look }: { topic: string; count: number; index: number; look: Look }) {
  const tint = useTopicTint(topic), c = useLookColors(), { fontScale } = useWindowDimensions();
  return <Entrance index={index} born={Date.now()} style={{ flexGrow: 1, flexBasis: fontScale >= 1.3 ? "100%" : 0 }}>
    <PressTarget accessibilityRole="button" accessibilityLabel={`${topic}. ${count} saved for now`}
      onPress={() => router.navigate({ pathname: "/library", params: { view: "now", at: String(Date.now()) } })}
      style={{ flexGrow: 1, minHeight: 112, backgroundColor: tint.wash, borderRadius: look.radii.card, padding: 16, gap: 10, justifyContent: "space-between" }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" }}>
        <Icon name={topicIcon(topic)} size={18} color={tint.ink} />
      </View>
      <View style={{ gap: 2 }}>
        <Text maxFontSizeMultiplier={2} numberOfLines={fontScale >= 1.3 ? undefined : 2} style={{ ...displayFace(look), fontSize: 17, lineHeight: 22, color: c.text }}>{topic}</Text>
        <Text maxFontSizeMultiplier={2} style={{ ...uiFace(look, "medium"), fontSize: 13, lineHeight: 17, color: tint.ink }}>{count} for now</Text>
      </View>
    </PressTarget>
  </Entrance>;
}
function WarmMoment({ progress, due, tips, now }: { progress: Progress; due: string; tips: BabyRecord[]; now: Date }) {
  const { look } = useLook(), c = useLookColors(), b = useBaby(), { fontScale } = useWindowDimensions(),
    collections = b.records.filter((r) => r.kind === "collection"), name = b.state.bootstrap?.profile.display_name.trim().split(/\s+/)[0];
  const fraction = Math.min(1, (progress.week + progress.day / 7) / TOTAL_WEEKS);
  const counts = new Map<string, number>();
  for (const row of tips) { const topic = tipTopic(row, collections); if (topic) counts.set(topic, (counts.get(topic) ?? 0) + 1); }
  const topics = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const stacked = fontScale >= 1.6;
  return <>
    <Text accessibilityRole="header" maxFontSizeMultiplier={1.8} style={{ ...displayFace(look), fontSize: 24, lineHeight: 30, color: c.text, marginTop: -6 }}>
      {greeting(now)}{name ? `, ${name}` : ""}
    </Text>
    <View accessible accessibilityLabel={`Week ${progress.week}, day ${progress.day} of 40. ${due}`}
      style={{ backgroundColor: c.hero, borderRadius: look.radii.hero, padding: 20, gap: 18, flexDirection: stacked ? "column" : "row", alignItems: stacked ? "flex-start" : "center", ...cardEdge(c.cardBorder, look) }}>
      <ProgressArc fraction={fraction} size={128} c={c} look={look} week={progress.week} />
      <View style={{ flex: stacked ? undefined : 1, gap: 6 }}>
        <Text maxFontSizeMultiplier={1.6} style={{ ...displayFace(look), fontSize: 24, lineHeight: 29, color: c.text }}>Week {progress.week}, day {progress.day}</Text>
        <Small look={look} c={c} tone="text" weight="medium">{due}</Small>
        <View style={{ alignSelf: "flex-start", marginTop: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.tabIndicator }}>
          <Small look={look} c={c} tone="text" weight="semibold">{progress.week >= 28 ? "Third trimester" : progress.week >= 14 ? "Second trimester" : "First trimester"}</Small>
        </View>
      </View>
    </View>
    {topics.length > 0 && <View style={{ gap: 12 }}>
      <SectionTitle look={look} c={c} title="Your topics this week" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {topics.map(([topic, count], index) => <TopicCard key={topic} topic={topic} count={count} index={index} look={look} />)}
      </View>
    </View>}
    <TipSection title="For now" view="now" rows={tips} empty="Tips you save for this point in your pregnancy show up here." />
  </>;
}

/** Today's pregnancy moment for the active look; Today keeps "Coming up" and the rest of the screen. */
export function TodayMoment({ child, today, now, tips }: { child: Child; today: Date; now: Date; tips: BabyRecord[] }) {
  const { look } = useLook(), progress = pregnancyProgress(child.due_date!, today), due = dueLine(child.due_date!, today);
  if (!progress) return null;
  if (look.variants.today === "scrapbook") return <ScrapbookMoment progress={progress} due={due} tips={tips} />;
  if (look.variants.today === "warm") return <WarmMoment progress={progress} due={due} tips={tips} now={now} />;
  return <SoftMoment progress={progress} due={due} tips={tips} />;
}
