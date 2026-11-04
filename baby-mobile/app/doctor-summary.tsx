import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useBaby } from "@/lib/context";
import { customProblem } from "@/lib/care-stats";
import { kindName, messageFor, type BabyRecord } from "@/lib/models";
import { friendlyTime } from "@/lib/care-format";
import { lastSummaryLevel, summaryEntries, summaryFileName, summaryHtml, summaryMaxDays } from "@/lib/doctor-summary";
import { exportOnePagePdf } from "@/lib/files";
import { profileToday, timingChild } from "@/lib/timing";
import { addDays, dayKey } from "@/lib/tracker";
import { useCareStats } from "@/lib/use-care-stats";
import { Button, Chips, Choice, Copy, Grouped, Notice, Screen, Section } from "@/components/ui";
import { DateField } from "@/components/date-field";

const isDay = (value?: string) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
type Entries = Awaited<ReturnType<typeof summaryEntries>>;

/** Choose dates and a baby, and get one page for the doctor. Open it from Tracker, Journal or `?child=&from=&to=` on an appointment. */
export default function DoctorSummary() {
  const b = useBaby(), params = useLocalSearchParams<{ child?: string; from?: string; to?: string }>(),
    timezone = b.state.bootstrap!.profile.timezone, children = b.state.bootstrap!.children, nowDate = new Date(),
    today = dayKey(profileToday(nowDate, timezone)),
    [childId, setChild] = useState<string | null>(params.child || (timingChild(b.state, profileToday(nowDate, timezone))?.id ?? null)),
    [from, setFrom] = useState(isDay(params.from) ? params.from! : addDays(today, -7)),
    [to, setTo] = useState(isDay(params.to) ? params.to! : today),
    problem = customProblem(from, to, today, summaryMaxDays),
    choice = useMemo(() => (problem ? null : { range: "custom" as const, from, to }), [problem, from, to]),
    answer = useCareStats(choice, childId),
    [entries, setEntries] = useState<{ key: string; rows: Entries } | null>(null),
    [entriesError, setEntriesError] = useState(""),
    // Questions and log notes start ticked. A journal entry is private, so it's only on the page if she ticks it.
    [picks, setPicks] = useState<Record<string, boolean>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""), [outcome, setOutcome] = useState(""),
    key = JSON.stringify([childId, from, to, b.state.outbox.length]);
  useEffect(() => {
    let active = true;
    if (problem) return;
    setEntriesError(""); setOutcome("");
    void summaryEntries(b.api, b.state, childId, from, to, timezone).then(
      (rows) => { if (active) setEntries({ key, rows }); },
      (e) => { if (active) setEntriesError(messageFor(e)); });
    return () => { active = false; };
  }, [key]);
  const rows = entries?.rows, on = (row: BabyRecord) => picks[row.id] ?? row.kind !== "journal",
    flip = (row: BabyRecord) => setPicks((prior) => ({ ...prior, [row.id]: !on(row) })),
    child = children.find((one) => one.id === childId) ?? null,
    ready = !problem && !!answer.stats && !!rows,
    list = (items: BabyRecord[], detail: (row: BabyRecord) => string, title: (row: BabyRecord) => string) => <Grouped separatorInset={16}>
      {items.map((row) => <View key={row.id} style={{ paddingHorizontal: 16 }}>
        <Choice label={title(row) || "Untitled"} detail={detail(row)} selected={on(row)} onPress={() => flip(row)} />
      </View>)}
    </Grouped>,
    when = (row: BabyRecord) => friendlyTime(row.occurred_at, nowDate, timezone);
  async function share() {
    setBusy(true); setError(""); setOutcome("");
    try {
      const page = { stats: answer.stats!, child, timezone, prepared: new Date(),
          questions: rows!.questions.filter(on),
          // What she ticked herself goes first, so a full page never drops it for a log note.
          notes: [...rows!.journal, ...rows!.logNotes].filter(on) },
        result = await exportOnePagePdf((level) => summaryHtml(page, level), lastSummaryLevel, b.owner, summaryFileName(from, to));
      if (!result.fits) setOutcome("This one runs past a page. Fewer days or notes will bring it back to one.");
      else if (result.level > 0) setOutcome("Some notes were shortened or left out to fit one page. The page says how many.");
    } catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  }
  return <Screen title="Doctor summary" back footer={<View style={{ gap: 8 }}>
    {/* Beside the button, since she may have scrolled a long way down to reach it. */}
    {!!outcome && <Notice>{outcome}</Notice>}
    {!!error && <Notice error>{error}</Notice>}
    <Button title="Share PDF" busy={busy} disabled={!ready} onPress={() => void share()} />
  </View>}>
    <Copy kind="small" tone="muted">One page with daily totals, your questions and the notes you choose.</Copy>
    {children.length > 1 && <Chips scroll label="Baby" value={childId ?? ""} onChange={(id) => setChild(id || null)} options={children.map((one) => ({ label: one.name, value: one.id }))} />}
    <View style={{ gap: 8 }}>
      <DateField dateOnly label="From" value={from} onChange={setFrom} />
      <DateField dateOnly label="To" value={to} onChange={setTo} />
    </View>
    {!!problem && <Notice>{problem}</Notice>}
    {!problem && !!answer.error && !answer.stats && <Notice>{answer.error}</Notice>}
    {!!entriesError && <Notice>{entriesError}</Notice>}
    {!!rows && <>
      <Section title="Questions for the doctor">
        {rows.questions.length ? list(rows.questions, (row) => row.body.trim().slice(0, 160), (row) => row.title) : <Copy kind="small" tone="muted">No questions saved yet.</Copy>}
      </Section>
      {rows.logNotes.length > 0 && <Section title="Notes on your logs">
        {list(rows.logNotes, (row) => `${when(row)}. ${row.body.trim().slice(0, 160)}`, (row) => kindName[row.kind])}
      </Section>}
      <Section title="Your journal">
        <Copy kind="small" tone="muted">Private. Only what you tick goes on the page.</Copy>
        {rows.journal.length ? list(rows.journal, (row) => `${when(row)}. ${row.body.trim().slice(0, 160)}`, (row) => row.title) : <Copy kind="small" tone="muted">Nothing in these dates.</Copy>}
      </Section>
    </>}
  </Screen>;
}
