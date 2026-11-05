import { useEffect, useMemo, useRef, useState } from "react";
import { Switch, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useWindowDimensions } from "react-native";
import { useBaby } from "@/lib/context";
import { customProblem, waitingEntries, type CareStats } from "@/lib/care-stats";
import { kindWord, messageFor, type BabyRecord } from "@/lib/models";
import { friendlyTime } from "@/lib/care-format";
import { atBirthWords, lastSummaryLevel, localEntries, logCounts, summaryEntries, SummaryTooLong, summaryFileName, summaryHtml, summaryMaxDays, summaryWords } from "@/lib/doctor-summary";
import { exportOnePagePdf } from "@/lib/files";
import { profileToday, timingChild } from "@/lib/timing";
import { addDays, dayKey } from "@/lib/tracker";
import { useCareStats } from "@/lib/use-care-stats";
import { Button, Chips, Choice, Copy, Grouped, Notice, Screen, Section, useColors } from "@/components/ui";
import { DateField } from "@/components/date-field";
import { SyncStatus } from "@/components/sync-status";
import { babyLabel } from "../lib/spaces";

const isDay = (value?: string) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
type Entries = ReturnType<typeof localEntries>;

/** Choose dates and a baby, and get one page for the doctor. Open it from Tracker, Journal or `?child=&from=&to=` on an appointment. */
export default function DoctorSummary() {
  const b = useBaby(), c = useColors(), params = useLocalSearchParams<{ child?: string; from?: string; to?: string }>(),
    { generation, children, profile: { timezone } } = b.state.bootstrap!, nowDate = new Date(),
    today = dayKey(profileToday(nowDate, timezone)),
    [childId, setChild] = useState<string | null>(params.child || (timingChild(b.state, profileToday(nowDate, timezone))?.id ?? null)),
    [from, setFrom] = useState(isDay(params.from) ? params.from! : addDays(today, -7)),
    [to, setTo] = useState(isDay(params.to) ? params.to! : today),
    problem = customProblem(from, to, today, summaryMaxDays),
    choice = useMemo(() => (problem ? null : { range: "custom" as const, from, to }), [problem, from, to]),
    answer = useCareStats(choice, childId),
    // `server` is false for what this phone holds, up at once and kept if the API can't be read (`failed`).
    [entries, setEntries] = useState<{ key: string; rows: Entries; server: boolean; failed: boolean; tooLong?: string } | null>(null),
    // Questions and log notes start ticked. A journal entry is private, so it's only on the page if she ticks it.
    [picks, setPicks] = useState<Record<string, boolean>>({}),
    // After the birth the page is the baby's, so hers stay off it until she asks, for this baby only: it may go to the pediatrician.
    [mineFor, setMineFor] = useState<string | null>(null),
    [busy, setBusy] = useState<"full" | "picked" | null>(null),
    [retrying, setRetrying] = useState(false), [attempt, setAttempt] = useState(0),
    [error, setError] = useState(""), [outcome, setOutcome] = useState(""),
    key = JSON.stringify([b.owner, generation, timezone, childId, from, to]),
    queue = b.state.outbox.map((change) => change.id).join(),
    // What the screen is on now, for a read that comes back after she's moved on.
    current = useRef({ key, state: b.state });
  current.current = { key, state: b.state };
  useEffect(() => {
    let active = true;
    if (problem) return;
    setOutcome(""); setError("");
    const phone = localEntries(b.state, childId, from, to, timezone);
    setEntries((prior) => (prior?.key === key ? prior : { key, rows: phone, server: false, failed: false }));
    void summaryEntries(b.api, b.state, childId, from, to, timezone).then(
      (rows) => { if (active) setEntries({ key, rows, server: true, failed: false }); },
      (e) => { if (active) setEntries({ key, rows: phone, server: false, failed: true, tooLong: e instanceof SummaryTooLong ? e.message : undefined }); });
    return () => { active = false; };
  }, [key, queue, attempt]);
  // A tick is for this baby's page. An entry with no baby shows on each, and shouldn't arrive already ticked.
  useEffect(() => { setPicks({}); }, [b.owner, generation, childId]);
  const held = entries?.key === key ? entries : undefined, rows = held?.rows, stats = answer.stats,
    on = (row: BabyRecord) => picks[row.id] ?? row.kind !== "journal",
    flip = (row: BabyRecord) => setPicks((prior) => ({ ...prior, [row.id]: !on(row) })),
    child = children.find((one) => one.id === childId) ?? null,
    mineOnPage = !child?.birth_date || (!!childId && mineFor === childId),
    picked = rows ? { questions: rows.questions.filter(on), notes: [...rows.journal, ...rows.logNotes].filter(on) } : null,
    waiting = stats ? waitingEntries(b.state, childId, stats, timezone) : 0,
    // Why the totals can't go on a page right now. A wrong total is worse than no page.
    why = problem ? "" : held?.tooLong ? held.tooLong : answer.error || held?.failed ? "Håfa can’t be reached right now, and the totals come from there. You can still share your questions and notes."
      : stats && !stats.complete ? "There are more logs in these days than a summary can add up at once, so its totals wouldn’t be right. Choose fewer days."
      : waiting === 1 ? "1 entry is still waiting to sync, so the totals would leave it out. You can share the full page once it’s synced, or your questions and notes now."
      : waiting ? `${waiting} entries are still waiting to sync, so the totals would leave them out. You can share the full page once they’ve synced, or your questions and notes now.` : "",
    ready = !problem && !why && !!stats && !!held?.server,
    list = (items: BabyRecord[], detail: (row: BabyRecord) => string, title: (row: BabyRecord) => string) => <Grouped separatorInset={16}>
      {items.map((row) => <View key={row.id} style={{ paddingHorizontal: 16 }}>
        <Choice label={title(row) || "Untitled"} detail={detail(row)} selected={on(row)} onPress={() => flip(row)} />
      </View>)}
    </Grouped>,
    when = (row: BabyRecord) => friendlyTime(row.occurred_at, nowDate, timezone),
    herList = (items: BabyRecord[]) => list(items, (row) => `${when(row)}. ${[typeof row.data.value === "number" ? `${row.data.value} ${row.data.unit ?? ""}`.trim() : row.title, row.body.trim().slice(0, 160)].filter(Boolean).join(" · ")}`, (row) => row.data.label ?? kindWord(row.kind));
  async function send(numbers: CareStats | null) {
    const page = { stats: numbers, child, timezone, prepared: new Date(),
        questions: picked!.questions,
        // What she ticked herself goes first, so a full page never drops it for a log note.
        notes: picked!.notes,
        // The full page only: the API has them all, and this phone may not.
        logs: numbers ? rows!.logs : [], her: numbers && mineOnPage ? rows!.her.filter(on) : [], atBirth: !!numbers },
      result = await exportOnePagePdf((level) => summaryHtml(page, level), lastSummaryLevel, b.owner, summaryFileName(from, to, numbers ? undefined : "questions-and-notes"));
    if (!result.fits) setOutcome("This one runs past a page, so it wasn’t shared. Choose fewer days or untick some notes, then share again.");
    else if (result.level > 0) setOutcome("Some notes were shortened or left out to fit one page. The page says how many.");
  }
  async function share() {
    setBusy("full"); setError(""); setOutcome("");
    try {
      // The totals as of now, not as of when this screen was opened.
      const latest = await b.api.careStats(choice!, childId).catch(() => null);
      if (current.current.key !== key) return;
      if (!latest || !latest.complete || waitingEntries(current.current.state, childId, latest, timezone)) {
        // The screen then says why. This is for someone scrolled far from there.
        setOutcome("Nothing was shared, because the totals couldn’t be confirmed just now.");
        void answer.refresh();
        return;
      }
      await send(latest);
    } catch (e) { setError(messageFor(e)); }
    finally { setBusy(null); }
  }
  async function sharePicked() {
    setBusy("picked"); setError(""); setOutcome("");
    try { await send(null); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(null); }
  }
  async function retry() {
    setRetrying(true); setError("");
    try {
      await b.sync().catch(() => undefined);
      await answer.refresh();
      setAttempt((count) => count + 1);
    } finally { setRetrying(false); }
  }
  const { fontScale } = useWindowDimensions(), buttons = <View style={{ gap: 8 }}>
    {/* Beside the button, since she may have scrolled a long way down to reach it. */}
    {!!outcome && <Notice>{outcome}</Notice>}
    {!!error && <Notice error>{error}</Notice>}
    <Button title="Share PDF" busy={busy === "full"} disabled={!ready || !!busy} onPress={() => void share()} />
    <Button secondary title="Share questions and notes" busy={busy === "picked"} disabled={!picked || !picked.questions.length && !picked.notes.length || !!busy} onPress={() => void sharePicked()} />
  </View>;
  // At large text a docked pair of buttons takes half the screen, so they go at the end of the page.
  return <Screen title="Doctor summary" back footer={fontScale < 1.5 ? buttons : undefined}>
    <Copy kind="small" tone="muted">One page with daily totals, your questions and the notes you choose.</Copy>
    {children.length > 1 && <Chips scroll label="Baby" value={childId ?? ""} onChange={(id) => setChild(id || null)} options={children.map((one) => ({ label: babyLabel(one, b.state.bootstrap), value: one.id }))} />}
    <View style={{ gap: 8 }}>
      <DateField dateOnly label="From" value={from} onChange={setFrom} />
      <DateField dateOnly label="To" value={to} onChange={setTo} />
    </View>
    {!!problem && <Notice>{problem}</Notice>}
    {!!why && <>
      <Notice>{why}</Notice>
      {waiting > 0 && <SyncStatus />}
      <Button secondary title="Try again" busy={retrying} onPress={() => void retry()} />
    </>}
    {!!rows && <>
      <Section title="Questions for the doctor">
        {rows.questions.length ? list(rows.questions, (row) => summaryWords(row).detail, (row) => summaryWords(row).title) : <Copy kind="small" tone="muted">No questions saved yet.</Copy>}
      </Section>
      {rows.logNotes.length > 0 && <Section title="Notes on your logs">
        {list(rows.logNotes, (row) => `${when(row)}. ${row.body.trim().slice(0, 160)}`, (row) => row.data.label ?? kindWord(row.kind))}
      </Section>}
      {(rows.logs.length > 0 || !!atBirthWords(child, rows.logs, timezone)) && <Section title="Also on the page">
        <Copy numeric kind="small" tone="muted">{[atBirthWords(child, rows.logs, timezone), logCounts(rows.logs)].filter(Boolean).join(" · ")}</Copy>
      </Section>}
      {!child?.birth_date && rows.her.length > 0 && <Section title="Your own logs">
        <Copy kind="small" tone="muted">As you typed them. Untick any you’d rather leave off.</Copy>
        {herList(rows.her)}
      </Section>}
      {!!child?.birth_date && <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 }}>
        <View style={{ flex: 1, minWidth: 0 }}><Copy kind="label">Include my own logs</Copy></View>
        <Switch accessibilityLabel="Include my own logs" value={mineOnPage} onValueChange={(on) => setMineFor(on ? childId : null)} trackColor={{ true: c.action }} />
      </View>}
      {!!child?.birth_date && mineOnPage && <Section title="Mom">
        {rows.her.length ? <>
          <Copy kind="small" tone="muted">On the full page, as you typed them. Untick any you’d rather leave off.</Copy>
          {herList(rows.her)}
        </> : <Copy kind="small" tone="muted">Nothing in these dates.</Copy>}
      </Section>}
      <Section title="Your journal">
        <Copy kind="small" tone="muted">Private. Only what you tick goes on the page.</Copy>
        {rows.journal.length ? list(rows.journal, (row) => [when(row), summaryWords(row).detail].filter(Boolean).join(". "), (row) => summaryWords(row).title) : <Copy kind="small" tone="muted">Nothing in these dates.</Copy>}
      </Section>
    </>}
    {fontScale >= 1.5 && buttons}
  </Screen>;
}
