import { HealthNote } from "../components/health-note";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { dayKey } from "../lib/tracker";
import { chartFromChild, chartUnit, growthNotes, measureWords, measuredOn, percentileWords, visibleGrowthNotes, type ChartSex, type Measure } from "../lib/growth-chart";
import { trackerById } from "@/lib/trackers";
import { profileToday, timingChild, todayStage } from "@/lib/timing";
import { useTodayCare } from "@/lib/today-care";
import { keyDate } from "../lib/tracker";
import { Button, Chips, Copy, Empty, FilterChips, Grouped, Notice, Row, Screen, Section } from "@/components/ui";
import { ChildFilter } from "@/components/child-filter";
import { useMinuteClock } from "@/components/care-glance";
import { MedicalSource } from "@/components/medical-source";
import { useLogFlow } from "@/components/quick-log";
import { SavedLog, TrackerPanel } from "@/components/tracker-panel";
import { GrowthChart } from "../components/growth-chart";

const ageWords = (months: number) => {
  const days = Math.round(months * 30.4375);
  return !days ? "At birth" : days < 14 ? `${days} day${days === 1 ? "" : "s"} old` : months < 3 ? `${Math.floor(days / 7)} weeks old` : `${Math.floor(months)} months old`;
};

/** A baby's measurements on CDC's WHO charts. It shows where a dot sits and how CDC describes the lines, and reads nothing into it. */
export default function Growth() {
  const b = useBaby(), now = useMinuteClock(), timeZone = b.state.bootstrap!.profile.timezone, today = profileToday(now, timeZone),
    child = timingChild(b.state, today), childId = child?.id ?? null,
    care = useTodayCare({ kinds: ["growth"], pages: 5, limit: 500, poll: false, child: childId }),
    [measure, setMeasure] = useState<Measure>("weight"),
    // The profile says, once it has an answer. Until then she picks one here, for this baby only, and nothing is stored about them.
    [picked, setPicked] = useState<{ childId: string | null; sex: ChartSex } | null>(null),
    sex = (picked?.childId === childId ? picked.sex : null) ?? (child ? chartFromChild(child) : null),
    flow = useLogFlow<string>(), scroller = useRef<ScrollView>(null), panelTop = useRef(0),
    tracker = trackerById("growth")!,
    points = child ? measuredOn(care.all, child, sex, measure, timeZone, dayKey(today)) : [],
    unit = chartUnit(points, measure),
    latest = points[points.length - 1],
    { cdc } = growthNotes;
  // The panel opens below the chart, so bring it up, clear of the top bar.
  useEffect(() => { if (flow.panel) scroller.current?.scrollTo({ y: Math.max(0, panelTop.current - 112), animated: true }); }, [flow.panel]);
  const summary = latest ? `${measureWords[measure]} chart. ${points.length} measurement${points.length === 1 ? "" : "s"}. The latest is ${latest.text}${latest.percentile === null ? "" : `, ${percentileWords(latest.percentile)}`}.` : `${measureWords[measure]} chart, with no measurements yet.`;
  const chooser = <Section title="Which chart">
    <Copy kind="small" tone="muted">CDC’s charts are separate for boys and girls.</Copy>
    <Chips label="Which chart" value={sex ?? ""} onChange={(next) => setPicked({ childId, sex: next as ChartSex })}
      options={[{ value: "girls", label: "Girls" }, { value: "boys", label: "Boys" }]} />
  </Section>;
  return <Screen scrollRef={scroller} title="Growth" subtitle={child?.name} back>
    <ChildFilter only={childId ?? undefined} />
    {!child || todayStage(child, today) !== "baby" ? <Empty icon="trending-up-outline" title="These start after birth" body="Add the birth date in Settings when your baby arrives." /> : <>
      <FilterChips label="Measurement" value={measure} onChange={(next) => setMeasure(next as Measure)} options={(["weight", "length", "head"] as const).map((one) => ({ value: one, label: measureWords[one] }))} />
      {!sex && chooser}
      {!!care.error && <Notice>Showing what’s on this phone. {care.error}</Notice>}
      {sex && <GrowthChart sex={sex} measure={measure} unit={unit} points={points} label={summary} />}
      <View onLayout={(event) => { panelTop.current = event.nativeEvent.layout.y; }} style={{ gap: 8 }}>
        <SavedLog flow={flow} now={now} timeZone={timeZone} />
        {flow.panel === tracker.id ? <TrackerPanel tracker={tracker} child={child} now={now} flow={flow} />
          : <Button secondary size="lg" icon="add" title="Add a measurement" onPress={() => flow.toggle(tracker.id)} />}
      </View>
      {points.length ? <Grouped>
        {[...points].reverse().map((point) => <Row key={point.record?.id ?? "birth"} numericTitle numericDetail title={point.text}
          detail={[point.atBirth && "At birth", keyDate(point.day).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), point.months >= 0 && !point.atBirth ? ageWords(point.months) : "", point.percentile !== null ? percentileWords(point.percentile) : point.onChart ? "" : "Outside this chart"].filter(Boolean).join(" · ")}
          icon="trending-up-outline" onPress={() => router.push(point.record ? { pathname: "/record/[id]", params: { id: point.record.id } } : { pathname: "/child", params: { id: child.id } })} />)}
      </Grouped> : <Copy kind="small" tone="muted">Measurements you log show up here, and on that day in Tracker.</Copy>}
      {!!sex && chooser}
      <Section title="About these charts">
        <Copy kind="small">{cdc.attribution}</Copy>
        {cdc.lines.map((line) => <Copy key={line.text} kind="small">{`“${line.text}”`}</Copy>)}
        <MedicalSource source={cdc.lines[0].source} url={cdc.lines[0].url} />
        <MedicalSource source={cdc.lines[1].source} url={cdc.lines[1].url} />
        {points.some((point) => point.months > 24) && <Copy kind="small">{`“${cdc.after_two.text}”`}</Copy>}
        <Copy kind="small" tone="muted">Age is counted from the birth date, and each percentile comes from CDC’s data file.</Copy>
        {visibleGrowthNotes().map((note) => <Copy key={note} kind="small">{note}</Copy>)}
        <Copy kind="small" tone="muted">{cdc.non_endorsement}</Copy>
      </Section>
    </>}
    <HealthNote />
  </Screen>;
}
