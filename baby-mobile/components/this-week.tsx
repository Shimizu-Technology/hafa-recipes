import { Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import type { Child } from "../lib/models";
import { findBag, packedLine } from "../lib/hospital-bag";
import { pregnancyProgress } from "../lib/timing";
import { callIf, dayOfLife, dayPlan, hiddenOnToday, todoDone, typicalNote, weekPlan, withHidden, type Sourced, type TodayCard, type Todo } from "../lib/this-week";
import { MedicalSource } from "./medical-source";
import { useExpectingVoice } from "./expecting-voice";
import { Copy, Grouped, PressTarget, Row, Section, fonts, typeScale, useColors, useToast } from "./ui";

/** "Hide", top right of the section, with Undo. What shows brings it back. */
function useHide(card: TodayCard, words: string) {
  const b = useBaby(), toast = useToast();
  const set = (hide: boolean) => b.commit((s) => ({ ...s, hiddenToday: withHidden(s.hiddenToday, card, hide) }));
  return {
    hidden: hiddenOnToday(b.state.hiddenToday, card),
    hide: () => void set(true).then(() => toast(`${words} hidden. What shows brings it back.`, { label: "Undo", onPress: () => void set(false) })),
  };
}
function HideLink({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <PressTarget accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress}
    style={{ minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" }}>
    <Text key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.subhead, fontFamily: fonts.semibold, color: c.accentText }}>Hide</Text>
  </PressTarget>;
}
function Lines({ lines }: { lines: Sourced[] }) {
  return <View style={{ gap: 10 }}>{lines.map((line) => <View key={line.text} style={{ gap: 0 }}>
    <Copy>{line.text}</Copy>
    <MedicalSource source={line.source.name} url={line.source.url} />
  </View>)}</View>;
}
const icons = { bag: "bag-handle-outline", question: "help-circle-outline", baby_doctor: "medkit-outline", delivery: "call-outline" } as const;

/** Before the birth, from week 28: what to expect this week and a few things to get ready, each one tap from where she'd do it. */
export function ThisWeek({ child, today }: { child: Child; today: Date }) {
  const b = useBaby(), { hidden, hide } = useHide("this_week", "This week"),
    progress = child.due_date ? pregnancyProgress(child.due_date, today) : null, shown = !hidden && !!progress && !!weekPlan(progress.week),
    voice = useExpectingVoice(child, shown), plan = progress ? weekPlan(progress.week, voice) : null;
  if (hidden || !plan) return null;
  const bag = findBag(b.records);
  function open(item: Todo) {
    if (item.link === "bag") router.push("/hospital-bag");
    else if (item.link === "question") router.push({ pathname: "/edit", params: { kind: "question" } });
    else if (item.link === "baby_doctor") router.push({ pathname: "/child", params: { id: child.id, doctor: "1" } });
    else router.push({ pathname: "/profile", params: { open: "delivery" } });
  }
  const detail = (item: Todo) => item.link === "bag" ? (bag ? packedLine(bag) : "A starter list to pack from")
    : todoDone(item, b.state.bootstrap, child) ? "Saved" : undefined;
  return <Section title="This week" action={<HideLink label="Hide This week" onPress={hide} />}>
    <Lines lines={plan.expect} />
    <Copy kind="small" tone="muted">Getting ready</Copy>
    <Grouped>
      {plan.prepare.map((item) => <Row key={item.id} wrap title={item.label} detail={detail(item)} numericDetail
        icon={todoDone(item, b.state.bootstrap, child) ? "checkmark-circle" : icons[item.link]} onPress={() => open(item)} />)}
    </Grouped>
  </Section>;
}

/** The first two weeks after the birth: "Day 3", what most babies do around now, and when to talk to the doctor. */
export function DayOfLife({ child, today }: { child: Child; today: Date }) {
  const { hidden, hide } = useHide("day_of_life", "These lines are"),
    day = child.birth_date ? dayOfLife(child.birth_date, today) : null, lines = day ? dayPlan(day, child.details?.feeding) : null;
  if (hidden || !day || !lines) return null;
  return <Section title={`Day ${day}`} action={<HideLink label={`Hide Day ${day}`} onPress={hide} />}>
    <Copy kind="small" tone="muted">{typicalNote}</Copy>
    <Lines lines={lines} />
    <View style={{ gap: 0 }}>
      <Copy kind="label">Talk to your baby’s doctor</Copy>
      <Copy kind="small">{callIf.text}</Copy>
      <MedicalSource source={callIf.source.name} url={callIf.source.url} />
    </View>
  </Section>;
}
