import { HealthNote } from "../components/health-note";
import { useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { acceptableDay, checkedMilestones, dayOfRecord, keepsakes, milestoneInstant, milestones, openingAge, type Milestone } from "@/lib/milestones";
import { messageFor, type BabyRecord } from "@/lib/models";
import { amendCare, careWrite, logCare, undoSaved } from "@/lib/quick-care";
import { profileToday, timingChild, todayStage } from "@/lib/timing";
import { useTodayCare } from "@/lib/today-care";
import { dayKey, keyDate } from "@/lib/tracker";
import { Button, Card, Copy, Empty, FilterChips, Grouped, Icon, Notice, PressTarget, Row, Screen, Section, radii, tap, useColors, useToast } from "@/components/ui";
import { ChildFilter } from "@/components/child-filter";
import { DateField } from "@/components/date-field";
import { Disclosure } from "@/components/disclosure";
import { MedicalSource } from "@/components/medical-source";
import { useMinuteClock } from "@/components/care-glance";

const longDay = (key: string) => keyDate(key).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

/** One of CDC's lines: a big target to check it, and once checked, its date, which she can change or take back. */
function MilestoneRow({ item, rows, day, open, onToggle, onOpen, onDay, onRemove }: {
  item: Milestone; rows?: BabyRecord[]; day?: string; open: boolean; onToggle: () => void; onOpen: () => void;
  onDay: (key: string) => void; onRemove: () => void;
}) {
  const c = useColors(), checked = !!rows?.length;
  return <View style={{ backgroundColor: c.surface, paddingHorizontal: 16, gap: 8, paddingBottom: open ? 12 : 0 }}>
    <PressTarget accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={item.text}
      accessibilityValue={day ? { text: longDay(day) } : undefined} accessibilityHint={checked ? "Shows its date" : "Saves this with today’s date"}
      onPress={checked ? onOpen : onToggle} style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
      <Icon name={checked ? "checkmark-circle" : "ellipse-outline"} size={28} color={checked ? c.accentText : c.muted} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Copy>{item.text}</Copy>
        {!!day && <Copy numeric kind="small" tone="muted">{longDay(day)}</Copy>}
      </View>
    </PressTarget>
    {open && !!day && <View style={{ gap: 8 }}>
      <DateField dateOnly label="Date" value={day} onChange={onDay} />
      <Button secondary title="Take this back" onPress={onRemove} />
    </View>}
  </View>;
}

/**
 * CDC's list for each child, and the moments a parent keeps from it. There's deliberately no count, progress, percentage
 * or "due" here: the app records what she saw, and never measures a child against the list.
 */
export default function Milestones() {
  const b = useBaby(), toast = useToast(), minute = useMinuteClock(), largeText = useWindowDimensions().fontScale >= 1.5,
    timeZone = b.state.bootstrap!.profile.timezone, today = profileToday(minute, timeZone), todayKey = dayKey(today),
    child = timingChild(b.state, today), childId = child?.id ?? null,
    care = useTodayCare({ kinds: ["milestone"], limit: 500, pages: 2, poll: false, child: childId }),
    checked = checkedMilestones(care.all, childId), kept = keepsakes(checked),
    [view, setView] = useState("age"), [ageId, setAgeId] = useState<string | null>(null), [openId, setOpenId] = useState<string | null>(null),
    age = milestones.ages.find((one) => one.id === ageId) ?? openingAge(child?.birth_date, today);
  async function check(item: Milestone) {
    if (!childId) return;
    tap("success");
    const record = { ...careWrite("milestone", childId, { milestone_id: item.id }, milestoneInstant(todayKey, timeZone)), title: item.text };
    try {
      const undo = await logCare(b, record);
      setOpenId(item.id);
      toast("Saved with today’s date.", { label: "Undo", onPress: async () => {
        try { await undo(); setOpenId(null); } catch (e) { toast(messageFor(e)); }
      } });
    } catch (e) { toast(messageFor(e)); }
  }
  function changeDay(rows: BabyRecord[], day: string) {
    if (!acceptableDay(day, child?.birth_date, todayKey)) return toast(`Choose a date from ${longDay(child?.birth_date ?? todayKey)} to today.`);
    void amendCare(b, rows[0].id, () => ({ occurred_at: milestoneInstant(day, timeZone).toISOString() })).catch((e) => toast(messageFor(e)));
  }
  function remove(rows: BabyRecord[]) {
    setOpenId(null);
    void Promise.all(rows.map((row) => undoSaved(b, row)())).catch((e) => toast(messageFor(e)));
  }
  const notBorn = !child || todayStage(child, today) !== "baby";
  // CDC's terms want this prominent, so it leads the list, except where its lines at the largest sizes would fill the screen.
  const credit = <View style={{ gap: 4 }}>
    <Copy kind="small">{milestones.attribution}</Copy>
    <Copy kind="small">{milestones.non_endorsement}</Copy>
    <MedicalSource source={`CDC, milestones by ${age.label}`} url={age.url} />
  </View>;
  return <Screen title="Milestones" subtitle={child?.name} back>
    <ChildFilter only={childId ?? undefined} />
    {notBorn ? <Empty icon="ribbon-outline" title="Milestones start after birth" body="Add the birth date in Settings when your baby arrives." /> : <>
      <FilterChips label="View" value={view} onChange={setView} options={[{ label: "By age", value: "age" }, { label: "Keepsakes", value: "kept" }]} />
      {!!care.error && <Notice>Showing what’s on this phone. {care.error}</Notice>}
      {view === "age" && <FilterChips label="Age" value={age.id} onChange={(id) => { setAgeId(id); setOpenId(null); }} options={milestones.ages.map((one) => ({ label: one.label, value: one.id }))} />}
      {!largeText && credit}
      {view === "age" ? <>
        <Copy kind="heading">{age.heading}</Copy>
        {age.domains.map((domain) => <Section key={domain.id} title={domain.title}>
          <Grouped separatorInset={56}>
            {domain.items.map((item) => {
              const rows = checked.get(item.id);
              return <MilestoneRow key={item.id} item={item} rows={rows} day={rows && dayOfRecord(rows[0], timeZone)} open={openId === item.id}
                onToggle={() => void check(item)} onOpen={() => setOpenId(openId === item.id ? null : item.id)}
                onDay={(day) => rows && changeDay(rows, day)} onRemove={() => rows && remove(rows)} />;
            })}
          </Grouped>
        </Section>)}
      </> : kept.length ? <Grouped>
        {kept.map((row) => <Row key={row.id} numericDetail title={row.title} detail={longDay(dayOfRecord(row, timeZone))} icon="ribbon-outline"
          onPress={() => router.push({ pathname: "/record/[id]", params: { id: row.id } })} />)}
      </Grouped> : <Empty icon="ribbon-outline" title="Nothing kept yet" body="Moments you check off show up here, with their dates." />}
      {largeText && credit}
      <Card tone="soft" style={{ gap: 8, borderRadius: radii.card }}>
        <Copy kind="small">{milestones.not_a_screening_tool}</Copy>
        <Disclosure title={milestones.concerned.title}>
          <View style={{ gap: 8 }}>
            <Copy kind="small">{milestones.concerned.text}</Copy>
            <Copy kind="small">{milestones.concerned.more}</Copy>
            <MedicalSource source="CDC, find your early intervention program" url={milestones.concerned.more_url} />
          </View>
        </Disclosure>
      </Card>
    </>}
    <Copy kind="small">These lists count age from birth. For a baby born early, ask your doctor about adjusted age when following development.</Copy>
    <MedicalSource source="AAP, adjusted age" url="https://www.healthychildren.org/English/ages-stages/baby/preemie/Pages/Preemie-Milestones.aspx" />
    <HealthNote />
  </Screen>;
}
