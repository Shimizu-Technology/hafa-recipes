import { estimatedAge, pregnancyVisit, medicalVisit } from "../lib/prenatal";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, useWindowDimensions } from "react-native";
import { useBaby } from "@/lib/context";
import { allDayChanged, attendeesFrom, categoryChoices, categoryValue, chooseCategory, dayName, detailsLine, detailsSet, herCategories, quickEvent, quickEvents, reminderChoices, reminderValue, repeatName, selectedSuggestion, startingAt, usedEventNames } from "@/lib/events";
import type { EditorDraft, EventRecurrence } from "@/lib/models";
import { pendingRecords } from "@/lib/outbox";
import { recordDay, zonedInstant } from "@/lib/tracker";
import { DateField } from "./date-field";
import { Disclosure } from "./disclosure";
import { Button, Choice, Copy, Field, FilterChips, Icon, Notice, PressTarget, fonts, tap, typeScale, useColors } from "./ui";
import { babiesFor, babyLabel, choiceFor, familySpaces, fittingChild, generationOf, spaceForNew } from "../lib/spaces";
import { eventNoteWhere } from "../lib/writing-places";

const familyId = (bootstrap: NonNullable<ReturnType<typeof useBaby>["state"]["bootstrap"]>) => familySpaces(bootstrap)[0]?.id;
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
    reminders = data.reminder_minutes ?? [], remindersOn = !!b.state.bootstrap!.reminders?.push,
    labels = useMemo(() => [...new Set(["Class", ...herCategories(pendingRecords(b.state)), ...(data.category_label ? [data.category_label] : [])])], [draft.existing]),
    [naming, setNaming] = useState(false), setAside = useRef<string | null | undefined>(null),
    bootstrap = b.state.bootstrap!, choice = choiceFor(bootstrap, draft),
    space = choice?.space_id ?? draft.space_id ?? spaceForNew(b.state, draft),
    // An event and its baby stay in one space, so only the babies in this one are offered.
    babies = draft.existing ? babiesFor(bootstrap, draft, b.records.find((row) => row.id === draft.id)) : space ? children.filter((child) => child.space_id === space) : children,
    place = choice ? (choice.shared ? "Shared with family" : "Just me") : "",
    // Choosing where it goes can't leave it pointing at a baby who isn't there.
    share = (shared: boolean) => {
      const target = shared ? familyId(bootstrap) : bootstrap.personal_space_id, wanted = shared && !draft.child_id ? setAside.current : draft.child_id,
        keeps = children.some((child) => child.id === wanted && child.space_id === target);
      // Set aside rather than lost, so switching back puts her back.
      setAside.current = !shared && !keeps ? draft.child_id : null;
      change({ shared, child_id: keeps ? wanted : null });
    },
    // A private event can't be on a baby the family shares. Only said when there's one it could have been on.
    offFamilyBaby = !!choice && !choice.shared && children.some((child) => child.space_id !== bootstrap.personal_space_id),
    baby = draft.child_id ? babies.find((child) => child.id === draft.child_id) : undefined;
  const medical = !medicalVisit(data) || familySpaces(bootstrap).find((item) => item.id === (space ?? draft.space_id))?.role !== "caregiver";
  const [defaults, setDefaults] = useState<{ doctor: string | null; location: string | null } | null>(null);
  const defaultSpace = space ?? draft.space_id ?? bootstrap.personal_space_id;
  const defaultsKey = `${defaultSpace ?? "personal"}:${generationOf(bootstrap, defaultSpace) ?? bootstrap.generation}`;
  useEffect(() => {
    let active = true; setDefaults(b.state.visitDefaults?.[defaultsKey] ?? null);
    if (data.category !== "appointment" || !b.api.visitDefaults) return;
    const lease = b.api.lease();
    void b.api.visitDefaults({ generation: generationOf(bootstrap, defaultSpace) ?? bootstrap.generation, ...(defaultSpace ? { space_id: defaultSpace } : {}) }).then((value) => { b.api.assertLease(lease); if (active) { setDefaults(value); void b.commit((state) => { b.api.assertLease(lease); return active ? { ...state, visitDefaults: { ...state.visitDefaults, [defaultsKey]: value } } : state; }).catch(() => {}); } }).catch(() => {});
    return () => { active = false; };
  }, [defaultsKey, data.category]);
  return <>
    {scope && <Notice>{one ? `This changes ${dayName(key, today)} only. The other dates stay as they are.` : `This changes ${dayName(key, today)} and every date after it. Earlier dates stay as they are.`}</Notice>}
    <Field label="Name" value={draft.title} maxLength={240} onChange={(title) => change({ title })} placeholder="What’s happening?" />
    {!draft.existing && quick && <FilterChips label="Suggestions" value={selectedSuggestion(draft)} options={[quickEvents[0], ...used, ...quickEvents.slice(1)].map(({ title }) => ({ label: title, value: title }))}
      onChange={(title) => change(quickEvent(draft, title, used))} />}
    {data.category === "appointment" && <Copy kind="small" tone="muted">Keeps your questions and what the doctor said with this visit, and lets you book the next one.</Copy>}
    {data.all_day
      ? <DateField label="When" dateOnly value={key} onChange={(day) => change({ occurred_at: zonedInstant(day, 0, 0, zone).toISOString() })} trailing={<AllDay on onPress={() => change(allDayChanged(draft, false))} />} />
      : <DateField label="When" timeZone={zone} value={draft.occurred_at} onChange={(start) => change(startingAt(draft, start))} trailing={<AllDay on={false} onPress={() => change(allDayChanged(draft, true))} />} />}
    {medical && !!data.paste_origin && (!draft.existing || !b.records.find((row) => row.id === draft.id)?.created_by || b.records.find((row) => row.id === draft.id)?.created_by === b.owner) && <Button secondary title="Remove original pasted words" onPress={() => set({ paste_origin: null })} />}
    {medical && data.category === "appointment" && !one && <>
      {defaults && <Button secondary title="Use saved clinic and doctor" onPress={() => set(defaults)} />}
      <Choice label="Offer this clinic and doctor on future visits in this space" selected={!!data.provider_default} onPress={() => set({ provider_default: !data.provider_default, provider_default_at: Date.now() })} />
      <FilterChips label="Previous clinic and doctor" value="" options={pendingRecords(b.state).filter((row) => row.kind === "event" && row.data.category === "appointment" && row.space_id === (space ?? draft.space_id) && (row.data.doctor || row.data.location)).slice(0, 5).map((row) => ({ label: [row.data.doctor, row.data.location].filter(Boolean).join(" · "), value: row.id }))} onChange={(id) => { const previous = b.records.find((row) => row.id === id); if (previous) set({ doctor: previous.data.doctor ?? null, location: previous.data.location ?? null }); }} />
      {!!estimatedAge(key, data.due_date_snapshot ?? baby?.due_date, baby?.birth_date) && <Copy kind="small" tone="muted">Estimated from due date: {estimatedAge(key, data.due_date_snapshot ?? baby?.due_date, baby?.birth_date)}</Copy>}
      {pregnancyVisit(key, baby?.birth_date) && <Field label="Clinic’s stated week (optional)" value={data.clinician_age ?? ""} maxLength={120} onChange={(clinician_age) => set({ clinician_age })} placeholder="Their words, for example 12w6d" />}
      <Field label="Doctor (optional)" value={data.doctor ?? ""} maxLength={240} onChange={(doctor) => set({ doctor })} />
      <Field label="Results (optional)" multiline value={data.results ?? ""} maxLength={10000} onChange={(results) => set({ results })} placeholder="Keep the words you were given" />
      <FilterChips label="Result status" value={data.result_status ?? "unknown"} options={[{ label: "Unknown", value: "unknown" }, { label: "Pending", value: "pending" }, { label: "Received", value: "received" }]} onChange={(result_status) => set({ result_status: result_status as "unknown" | "pending" | "received" })} />
      <Field label="Follow up (optional)" multiline value={data.follow_up ?? ""} maxLength={2000} onChange={(follow_up) => set({ follow_up })} />
      <Copy kind="small" tone="muted">Saving these words does not create a reminder.</Copy>
    </>}
    {/* Book next carries over what the last visit had, and is still one tap from saving. */}
    <Disclosure title="More details" detail={[detailsLine(draft, remindersOn), baby && babyLabel(baby, bootstrap), place].filter(Boolean).join(" · ")} startOpen={(draft.existing || quick) && detailsSet(draft, remindersOn)}>
      {!one && <Copy kind="small">Repeat</Copy>}
      {!one && <FilterChips label="Repeat" value={rule?.frequency ?? ""} options={[{ label: "Doesn’t repeat", value: "" }, ...repeats]}
        onChange={(frequency) => set({ recurrence: frequency ? { ...rule, interval: rule?.frequency === frequency ? rule.interval : 1, frequency: frequency as EventRecurrence["frequency"] } : null })} />}
      {!one && rule && <DateField label="Repeat until (optional)" dateOnly optional value={rule.until} onChange={(until) => set({ recurrence: { ...rule, until: until || null } })} />}
      <Copy kind="small">Category</Copy>
      <FilterChips wrap label="Category" value={naming ? "new" : categoryValue(data)} options={[...categoryChoices(labels, c.categories), { label: "New…", value: "new", dot: undefined, icon: "add" as const }]}
        onChange={(value) => { setNaming(value === "new"); if (value !== "new") set(chooseCategory(data, value)); else set({ category: "other", category_label: null }); }} />
      {naming && <Field label="Your category" autoFocus value={data.category_label ?? ""} maxLength={60} onChange={(label) => set({ category: "other", category_label: label })} placeholder="Car, work, church…" />}
      <Field label="Location (optional)" value={data.location ?? ""} maxLength={240} onChange={(location) => set({ location })} placeholder="Clinic, church, grandma’s house…" />
      <Field label="Who’s coming (optional)" capitalize="words" value={people} onChange={(typed) => { setPeople(typed); set({ attendees: attendeesFrom(typed) }); }} placeholder="Grandma, Auntie Rose" />
      {!one && babies.length > 0 && <Copy kind="small">Who is it for?</Copy>}
      {!one && babies.length > 0 && <FilterChips label="Who is it for?" value={fittingChild(bootstrap, draft, b.records.find((row) => row.id === draft.id)) ?? ""}
        options={[{ label: choice && !choice.shared ? "Just me" : "Whole family", value: "" }, ...babies.map((child) => ({ label: babyLabel(child, b.state.bootstrap), value: child.id }))]} onChange={(id) => change({ child_id: id || null })} />}
      {/* Only once reminders are on: a choice that does nothing yet would be a promise. One she already has is kept. */}
      {!one && remindersOn && <Copy kind="small">Reminder</Copy>}
      {!one && remindersOn && <FilterChips label="Reminder" value={reminderValue(reminders)} options={reminderChoices(!!data.all_day, reminders)}
        onChange={(value) => { if (value !== "several") set({ reminder_minutes: value ? [Number(value)] : [] }); }} />}
      {!one && medical && <Field label="Note (optional)" multiline value={draft.body} onChange={(body) => change({ body })} placeholder="Anything to remember about it" />}
      {!one && <Copy kind="small" tone="muted">{eventNoteWhere(b.state, draft, b.records.find((row) => row.id === draft.id))}</Copy>}
      {!!choice && <Copy kind="small">Who can see this</Copy>}
      {!!choice && <FilterChips label="Who can see this" value={choice.shared ? "shared" : "just_me"} options={[{ label: "Shared with family", value: "shared" }, { label: "Just me", value: "just_me" }]}
        onChange={(value) => share(value === "shared")} />}
      {offFamilyBaby && <Copy kind="small" tone="muted">A Just me event can’t be on the family’s baby.</Copy>}
    </Disclosure>
  </>;
}
