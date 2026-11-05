import { useMemo, useState } from "react";
import { Text, useWindowDimensions } from "react-native";
import { useBaby } from "@/lib/context";
import { allDayChanged, attendeesFrom, dayName, detailsLine, detailsSet, eventCategories, quickEvent, quickEvents, reminderChoices, reminderValue, repeatName, selectedSuggestion, startingAt, usedEventNames } from "@/lib/events";
import type { EditorDraft, EventCategory, EventRecurrence } from "@/lib/models";
import { pendingRecords } from "@/lib/outbox";
import { recordDay, zonedInstant } from "@/lib/tracker";
import { DateField } from "./date-field";
import { Disclosure } from "./disclosure";
import { Copy, Field, FilterChips, Icon, Notice, PressTarget, fonts, tap, typeScale, useColors } from "./ui";
import { babyLabel } from "../lib/spaces";

const frequencies: EventRecurrence["frequency"][] = ["daily", "weekly", "monthly", "yearly"];

/** On the date's own row, the same height as it. A switch to VoiceOver, and a pill to the eye. */
function AllDay({ on, onPress }: { on: boolean; onPress: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <PressTarget accessibilityRole="switch" accessibilityLabel="All day" accessibilityState={{ checked: on }} onPress={() => { tap(); onPress(); }}
    style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: on ? c.action : c.soft }}>
    {on && <Icon name="checkmark" size={16} color={c.onAction} />}
    <Text key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.subhead, fontFamily: fonts.semibold, color: on ? c.onAction : c.text }}>All day</Text>
  </PressTarget>;
}

/**
 * The form for one event. A name and a date are enough, and they're all it opens with: suggestions fill the name and never
 * limit it, and the rest sits behind one More details, which says in a line what it holds while it's shut.
 */
export function EventFields({ draft, change, today, quick = true }: { draft: EditorDraft; change: (value: Partial<EditorDraft>) => void; today: string; quick?: boolean }) {
  const b = useBaby(), c = useColors(), { data } = draft, zone = data.timezone, children = b.state.bootstrap!.children, scope = draft.event_edit?.scope, one = scope === "one",
    key = recordDay(draft.occurred_at, zone), rule = data.recurrence, set = (value: Partial<EditorDraft["data"]>) => change({ data: { ...data, ...value } }),
    // A repeat every two weeks stays as it is until she picks something else.
    repeats = frequencies.map((frequency) => ({ label: repeatName(rule?.frequency === frequency ? rule : { frequency }), value: frequency })),
    used = useMemo(() => (quick && !draft.existing ? usedEventNames(pendingRecords(b.state)) : []), [quick, draft.existing]),
    // Typing can't take a comma away: the names she means are worked out from what she sees.
    [people, setPeople] = useState((data.attendees ?? []).join(", ")),
    reminders = data.reminder_minutes ?? [];
  return <>
    {scope && <Notice>{one ? `This changes ${dayName(key, today)} only. The other dates stay as they are.` : `This changes ${dayName(key, today)} and every date after it. Earlier dates stay as they are.`}</Notice>}
    <Field label="Name" value={draft.title} maxLength={240} onChange={(title) => change({ title })} placeholder="What’s happening?" />
    {!draft.existing && quick && <FilterChips label="Suggestions" value={selectedSuggestion(draft)} options={[quickEvents[0], ...used, ...quickEvents.slice(1)].map(({ title }) => ({ label: title, value: title }))}
      onChange={(title) => change(quickEvent(draft, title, used))} />}
    {data.all_day
      ? <DateField label="When" dateOnly value={key} onChange={(day) => change({ occurred_at: zonedInstant(day, 0, 0, zone).toISOString() })} trailing={<AllDay on onPress={() => change(allDayChanged(draft, false))} />} />
      : <DateField label="When" timeZone={zone} value={draft.occurred_at} onChange={(start) => change(startingAt(draft, start))} trailing={<AllDay on={false} onPress={() => change(allDayChanged(draft, true))} />} />}
    {/* Book next carries over what the last visit had, and is still one tap from saving. */}
    <Disclosure title="More details" detail={detailsLine(draft)} startOpen={(draft.existing || quick) && detailsSet(draft)}>
      {!one && <Copy kind="small">Repeat</Copy>}
      {!one && <FilterChips label="Repeat" value={rule?.frequency ?? ""} options={[{ label: "Doesn’t repeat", value: "" }, ...repeats]}
        onChange={(frequency) => set({ recurrence: frequency ? { ...rule, interval: rule?.frequency === frequency ? rule.interval : 1, frequency: frequency as EventRecurrence["frequency"] } : null })} />}
      {!one && rule && <DateField label="Repeat until (optional)" dateOnly optional value={rule.until} onChange={(until) => set({ recurrence: { ...rule, until: until || null } })} />}
      <Copy kind="small">Category</Copy>
      <FilterChips wrap label="Category" value={data.category ?? "other"} options={eventCategories.map(({ value, label }) => ({ value, label, dot: c.categories?.[value] }))}
        onChange={(category) => set({ category: category as EventCategory })} />
      <Field label="Location (optional)" value={data.location ?? ""} maxLength={240} onChange={(location) => set({ location })} placeholder="Clinic, church, grandma’s house…" />
      <Field label="Who’s coming (optional)" value={people} onChange={(typed) => { setPeople(typed); set({ attendees: attendeesFrom(typed) }); }} placeholder="Grandma, Auntie Rose" />
      {!one && children.length > 0 && <Copy kind="small">Who is it for?</Copy>}
      {!one && children.length > 0 && <FilterChips label="Who is it for?" value={draft.child_id ?? ""}
        options={[{ label: "Whole family", value: "" }, ...children.map((child) => ({ label: babyLabel(child, b.state.bootstrap), value: child.id }))]} onChange={(id) => change({ child_id: id || null })} />}
      {!one && <Copy kind="small">Reminder</Copy>}
      {!one && <FilterChips label="Reminder" value={reminderValue(reminders)} options={reminderChoices(!!data.all_day, reminders)}
        onChange={(value) => { if (value !== "several") set({ reminder_minutes: value ? [Number(value)] : [] }); }} />}
      {!one && !!reminders.length && <Copy kind="small" tone="muted">It reaches this phone once notifications are on for Håfa Baby.</Copy>}
      {!one && <Field label="Note (optional)" multiline value={draft.body} onChange={(body) => change({ body })} placeholder="Anything to remember about it" />}
    </Disclosure>
  </>;
}
