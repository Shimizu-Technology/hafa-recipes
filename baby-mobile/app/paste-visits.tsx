import { useState } from "react";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { useBaby } from "../lib/context";
import { Button, Card, Choice, Copy, Field, FilterChips, Notice, Row, Screen } from "../components/ui";
import { pasteVisits, validDay, withPasteYear, suggestedPasteYear, type PastedItem } from "../lib/paste-visits";
import { addMutation, pendingRecords } from "../lib/outbox";
import { familySpaces, generationOf } from "../lib/spaces";
import { messageFor, type RecordWrite } from "../lib/models";
import { tooLong } from "../lib/text-limits";
import { zonedInstant } from "../lib/tracker";

import { Disclosure } from "../components/disclosure";
import { DateField } from "../components/date-field";

const dateLabel = (day: string) => validDay(day) ? new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Choose a date";

type ScopedWrite = RecordWrite & { space_id?: string };
type Candidate = PastedItem & { id: string; selected: boolean; kind: "event" | "journal"; title: string; age: string; shared: boolean };
/** Review is local. Only the explicit confirmation writes to the durable outbox. */
export default function PasteVisits() {
  const b = useBaby(), [original, setOriginal] = useState(""), [items, setItems] = useState<Candidate[] | null>(null),
    [pregnancyId, setPregnancyId] = useState(""), [year, setYear] = useState(""), [acceptedYear, setAcceptedYear] = useState(""), [originalTitle, setOriginalTitle] = useState("Original pregnancy notes"), [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState<RecordWrite[]>([]);
  const expecting = b.state.bootstrap!.children.filter((child) => child.due_date && !child.birth_date),
    pregnancy = expecting.find((child) => child.id === pregnancyId) ?? (expecting.length === 1 ? expecting[0] : undefined);
  const family = familySpaces(b.state.bootstrap).find((space) => space.role === "parent");
  const visitCount = items?.filter((row) => row.kind === "event").length ?? 0, momentCount = items?.filter((row) => row.kind === "journal").length ?? 0;
  const chosen = items?.filter((row) => row.selected) ?? [],
    yearMissing = !!items?.some((row) => row.yearless && !validDay(row.day)),
    yearPending = chosen.some((row) => row.yearless) && year !== acceptedYear,
    suggestion = suggestedPasteYear(items ?? [], pregnancy?.due_date),
    saveLabel = `Save ${chosen.length} ${chosen.length === 1 ? "item" : "items"}`;
  const change = (id: string, patch: Partial<Candidate>) => setItems((rows) => rows!.map((row) => row.id === id ? { ...row, ...patch } : row));
  function review() {
    const error = tooLong("", original, "original note"); setError(error);
    if (!error) {
      const parsed = pasteVisits(original);
      setYear(suggestedPasteYear(parsed, pregnancy?.due_date) ?? ""); setAcceptedYear("");
      setItems(parsed.map((row) => ({ ...row, id: Crypto.randomUUID(), selected: true, shared: false, kind: row.kind ?? "event", title: row.title ?? (row.kind === "journal" ? "Pregnancy moment" : "Prenatal visit"), age: row.age ?? "" })));
    }
  }
  async function confirm() {
    if (busy) return;
    const lease = b.api.lease();
    setBusy(true); setError("");
    try {
      if (b.state.bootstrap!.visit_import_available !== true) throw Error("Connect to an updated Håfa Baby service before confirming. Your review is still here.");
      if (expecting.length > 1 && !pregnancy) throw Error("Choose the expecting baby for these prenatal visits.");
      const chosen = items!.filter((row) => row.selected);
      if (yearPending) throw Error("Choose the year for these dates before saving.");
      const lengthError = tooLong("", original, "original note") || chosen.map((row) => tooLong(row.title, row.text)).find(Boolean);
      if (lengthError) throw Error(lengthError);
      if (!chosen.length || chosen.some((row) => !validDay(row.day) || !row.title.trim())) throw Error("Choose at least one item, with a valid date and title for each.");
      const boot = b.state.bootstrap!, space = boot.personal_space_id, generation = generationOf(boot, space) ?? boot.generation,
        zone = boot.profile.timezone,
        baby = pregnancy && (!space || pregnancy.space_id === space) ? pregnancy : undefined,
        familyBaby = pregnancy?.space_id === family?.id ? pregnancy : undefined,
        selectedDue = pregnancy?.due_date;
      const idFrom = (hash: string) => `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      const originalId = idFrom(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([b.owner, space ?? "personal", generation, "original", original])));
      const previousOriginal = pendingRecords(b.state).find((row) => row.id === originalId);
      const identities = new Map<string, string>();
      for (const row of chosen) {
        const target = row.shared && family ? family.id : space;
        const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([target ?? b.owner, generationOf(boot, target) ?? generation, (row.shared ? familyBaby : baby)?.id ?? pregnancy?.id ?? null, row.kind, row.day, row.text]));
        // Preserve a known capture made before child-scoped identities were introduced.
        const child = (row.shared ? familyBaby : baby)?.id ?? null;
        const previous = child ? pendingRecords(b.state).find((known) => known.space_id === target && known.child_id === child && known.kind === row.kind && known.body === row.text && Date.parse(known.occurred_at) === zonedInstant(row.day, 0, 0, zone).getTime() && known.data.paste_origin?.text === original.slice(row.start, row.end)) : undefined;
        identities.set(row.id, previous?.id ?? idFrom(hash));
      }
      const records: ScopedWrite[] = [{ id: originalId, kind: "journal", title: originalTitle.trim() || "Original pregnancy notes", body: original, child_id: baby?.id ?? null, occurred_at: previousOriginal?.occurred_at ?? new Date().toISOString(), data: { provenance: "caregiver_observation", paste_origin: { text: original, start: 0, end: original.length, original: true } } },
        ...chosen.map((row): ScopedWrite => ({ ...(row.shared && family ? { space_id: family.id } : space ? { space_id: space } : {}), id: identities.get(row.id)!, kind: row.kind, title: row.title, body: row.text, child_id: (row.shared ? familyBaby : baby)?.id ?? null,
          occurred_at: zonedInstant(row.day, 0, 0, zone).toISOString(), data: { paste_origin: { text: original.slice(row.start, row.end), start: row.start, end: row.end, original: false }, ...(row.kind === "event" ? { category: "appointment", ...(!row.shared ? { just_me: true } : {}), timezone: zone, all_day: true, reminder_minutes: [], clinician_age: row.age,
            ...((row.shared ? familyBaby?.due_date : baby?.due_date ?? selectedDue) ? { due_date_snapshot: (row.shared ? familyBaby?.due_date : baby?.due_date ?? selectedDue)! } : {}) } : { provenance: "caregiver_observation" as const }) } }))];
      b.api.assertLease(lease);
      await b.commit((state) => {
        b.api.assertLease(lease);
        const known = pendingRecords(state);
        const fingerprints = new Set<string>();
        for (const record of records.slice(1)) {
          const fingerprint = JSON.stringify([record.space_id ?? space, record.child_id, record.kind, record.occurred_at, record.body]);
          if (fingerprints.has(fingerprint)) throw Error("Two selected items are identical. Uncheck one before confirming.");
          fingerprints.add(fingerprint);
        }
        for (const record of records.slice(1)) if (known.some((row) => row.id !== record.id && row.space_id === (record.space_id ?? space) && row.child_id === record.child_id && (record.child_id !== null || !pregnancy) && row.kind === record.kind && Date.parse(row.occurred_at) === Date.parse(record.occurred_at) && row.body === record.body)) throw Error("A matching item is already saved. Uncheck that item before confirming.");
        return records.reduce((next, record) => addMutation(next, { id: record.id, generation: generationOf(boot, record.space_id ?? space) ?? generation, ...((record.space_id ?? space) ? { space_id: record.space_id ?? space } : {}), type: "save", record, files: [] }), state);
      });
      setSaved(records); void b.sync();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }
  return <Screen title="Bring in pregnancy notes" back footer={!saved.length ? items ? <Button title={saveLabel} disabled={!chosen.length || yearPending || chosen.some((row) => !validDay(row.day) || !row.title.trim())} busy={busy} onPress={() => void confirm()} /> : <Button title="Review your note" disabled={!original.trim()} onPress={review} /> : undefined}>
    {!!error && <Notice error>{error}</Notice>}
    {saved.length ? <><Notice>Saved on this phone. You can find these in Journal.</Notice>{saved.map((row) => <Row key={row.id} title={b.records?.find((known) => known.id === row.id)?.title ?? row.title} onPress={() => router.push({ pathname: row.kind === "event" ? "/event/[id]" : "/record/[id]", params: { id: row.id } })} />)}</> : <>
      {!items ? <>
        <Copy>Bring your visits and little moments together. We’ll keep your exact words, and you can check everything before saving.</Copy>
        <Field label="Note title" value={originalTitle} maxLength={240} onChange={setOriginalTitle} />
        <Field label="Paste your note" multiline value={original} onChange={setOriginal} />

      </> : <>
        <Copy kind="heading">{visitCount} {visitCount === 1 ? "visit" : "visits"} and {momentCount} {momentCount === 1 ? "moment" : "moments"} from your note</Copy>
        <Copy>Check the dates and words below. Nothing is saved yet. Items stay personal unless you share them; your original note stays private.</Copy>
        {pregnancy && <Copy kind="small">Visits for {pregnancy.name}.</Copy>}
        {!expecting.length && <Copy kind="small">You can add a baby profile later.</Copy>}
        {expecting.length > 1 && <FilterChips label="Expecting baby" value={pregnancyId} options={expecting.map((child) => ({ label: child.name, value: child.id }))} onChange={(id) => { setPregnancyId(id); setYear(suggestedPasteYear(items, expecting.find((child) => child.id === id)?.due_date) ?? ""); setAcceptedYear(""); }} />}
        {(yearMissing || yearPending) && <Card style={{ gap: 12 }}>
          <Field label="Which year were these?" value={year} onChange={setYear} />
          {suggestion && year === suggestion && <Copy kind="small" tone="muted">{suggestion} fits your due date. Please check before using it.</Copy>}
          <Button secondary title={/^\d{4}$/.test(year) ? `Use ${year}` : "Use this year"} disabled={!/^\d{4}$/.test(year)} onPress={() => { setItems(withPasteYear(items, year)); setAcceptedYear(year); }} />
        </Card>}
        {!yearMissing && !yearPending && acceptedYear && items.some((row) => row.yearless) && <Row title={`Using ${acceptedYear}`} detail="Change year" onPress={() => setAcceptedYear("")} />}
        {items.map((row) => <Card key={row.id} style={{ gap: 12 }}>
          {row.title !== row.text.trim() && <Copy kind="heading">{row.title}</Copy>}
          <Copy kind="small" tone="muted">{validDay(row.day) ? dateLabel(row.day) : row.yearless && /^\d{4}$/.test(year) && validDay(`${year}-${row.yearless}`) ? `${dateLabel(`${year}-${row.yearless}`)} · check year above` : "Choose a date"}</Copy>
          <Copy>{row.text}</Copy>
          <Choice label="Include this item" selected={row.selected} onPress={() => change(row.id, { selected: !row.selected })} />
          <Disclosure title="Edit item">
            <DateField label="Date" dateOnly value={row.day || null} onChange={(day) => change(row.id, { day, yearless: "" })} />
            <Field label="Title" value={row.title} maxLength={240} onChange={(title) => change(row.id, { title })} />
            <FilterChips label="Type" value={row.kind} options={[{ label: "Visit", value: "event" }, { label: "Moment", value: "journal" }]} onChange={(kind) => change(row.id, { kind: kind as Candidate["kind"] })} />
            {row.kind === "event" && <Field label="Clinic’s stated week (optional)" value={row.age} maxLength={120} onChange={(age) => change(row.id, { age })} />}
            <Field label="Your words" multiline value={row.text} onChange={(text) => change(row.id, { text })} />
            {!!family && <Choice label="Share this item and its original words with family" selected={row.shared} onPress={() => change(row.id, { shared: !row.shared })} />}
          </Disclosure>
        </Card>)}
        <Button secondary title="Back to your note" disabled={busy} onPress={() => setItems(null)} />
      </>}
    </>}
  </Screen>;
}
