import { useState } from "react";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { useBaby } from "../lib/context";
import { Button, Card, Choice, Copy, Field, FilterChips, Notice, Row, Screen } from "../components/ui";
import { pasteVisits, validDay, type PastedItem } from "../lib/paste-visits";
import { addMutation, pendingRecords } from "../lib/outbox";
import { familySpaces, generationOf } from "../lib/spaces";
import { messageFor, type RecordWrite } from "../lib/models";
import { tooLong } from "../lib/text-limits";
import { zonedInstant } from "../lib/tracker";

type ScopedWrite = RecordWrite & { space_id?: string };
type Candidate = PastedItem & { id: string; selected: boolean; kind: "event" | "journal"; title: string; age: string; shared: boolean };
/** Review is local. Only the explicit confirmation writes to the durable outbox. */
export default function PasteVisits() {
  const b = useBaby(), [original, setOriginal] = useState(""), [items, setItems] = useState<Candidate[] | null>(null),
    [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState<RecordWrite[]>([]);
  const family = familySpaces(b.state.bootstrap).find((space) => space.role === "parent");
  const change = (id: string, patch: Partial<Candidate>) => setItems((rows) => rows!.map((row) => row.id === id ? { ...row, ...patch } : row));
  async function confirm() {
    if (busy) return;
    const lease = b.api.lease();
    setBusy(true); setError("");
    try {
      const chosen = items!.filter((row) => row.selected);
      const lengthError = tooLong("", original, "original note") || chosen.map((row) => tooLong(row.title, row.text)).find(Boolean);
      if (lengthError) throw Error(lengthError);
      if (!chosen.length || chosen.some((row) => !validDay(row.day) || !row.title.trim())) throw Error("Choose at least one item, with a valid date and title for each.");
      const boot = b.state.bootstrap!, space = boot.personal_space_id, generation = generationOf(boot, space) ?? boot.generation,
        zone = boot.profile.timezone, pregnancies = boot.children.filter((child) => child.due_date && !child.birth_date && (!space || child.space_id === space)),
        baby = boot.children.find((child) => child.id === b.state.selectedChild && (!space || child.space_id === space)) ?? (pregnancies.length === 1 ? pregnancies[0] : undefined);
      const idFrom = (hash: string) => `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      const originalId = idFrom(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([b.owner, space ?? "personal", generation, "original", original])));
      const previousOriginal = pendingRecords(b.state).find((row) => row.id === originalId);
      const identities = new Map<string, string>();
      for (const row of chosen) {
        const target = row.shared && family ? family.id : space;
        const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([b.owner, target ?? "personal", generationOf(boot, target) ?? generation, row.kind, row.day, row.text]));
        identities.set(row.id, idFrom(hash));
      }
      const records: ScopedWrite[] = [{ id: originalId, kind: "journal", title: "Original pregnancy notes", body: original, child_id: baby?.id ?? null, occurred_at: previousOriginal?.occurred_at ?? new Date().toISOString(), data: { provenance: "caregiver_observation" } },
        ...chosen.map((row): ScopedWrite => ({ ...(row.shared && family ? { space_id: family.id } : space ? { space_id: space } : {}), id: identities.get(row.id)!, kind: row.kind, title: row.title, body: row.text, child_id: row.shared ? null : baby?.id ?? null,
          occurred_at: zonedInstant(row.day, 0, 0, zone).toISOString(), data: row.kind === "event" ? { category: "appointment", timezone: zone, all_day: true, reminder_minutes: [], clinician_age: row.age,
            ...(!row.shared && baby?.due_date ? { due_date_snapshot: baby.due_date } : {}) } : { provenance: "caregiver_observation" } }))];
      b.api.assertLease(lease);
      await b.commit((state) => {
        b.api.assertLease(lease);
        const known = pendingRecords(state);
        const fingerprints = new Set<string>();
        for (const record of records.slice(1)) {
          const fingerprint = JSON.stringify([record.space_id ?? space, record.kind, record.occurred_at, record.body]);
          if (fingerprints.has(fingerprint)) throw Error("Two selected items are identical. Uncheck one before confirming.");
          fingerprints.add(fingerprint);
        }
        for (const record of records.slice(1)) if (known.some((row) => row.id !== record.id && row.space_id === (record.space_id ?? space) && row.kind === record.kind && row.occurred_at === record.occurred_at && row.body === record.body)) throw Error("A matching item is already saved. Uncheck that item before confirming.");
        return records.reduce((next, record) => addMutation(next, { id: record.id, generation: generationOf(boot, record.space_id ?? space) ?? generation, ...((record.space_id ?? space) ? { space_id: record.space_id ?? space } : {}), type: "save", record, files: [] }), state);
      });
      setSaved(records); void b.sync();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }
  return <Screen title="Bring in pregnancy notes" back>
    {!!error && <Notice error>{error}</Notice>}
    {saved.length ? <><Notice>Saved on this phone. Sync status is available in Journal.</Notice>{saved.map((row) => <Row key={row.id} title={row.title} onPress={() => router.push({ pathname: row.kind === "event" ? "/event/[id]" : "/record/[id]", params: { id: row.id } })} />)}</> : <>
      <Copy>Personal by default. Your original stays private and intact. Nothing is saved until you confirm. You can choose sharing later in each entry.</Copy>
      {!items ? <><Field label="Paste your note" multiline value={original} onChange={setOriginal} /><Button title="Review dated items" disabled={!original.trim()} onPress={() => { const error = tooLong("", original, "original note"); setError(error); if (!error) setItems(pasteVisits(original).map((row) => ({ ...row, id: Crypto.randomUUID(), selected: false, shared: false, kind: "event", title: "Prenatal visit", age: "" }))); }} /></> : <>
        <Copy kind="small" tone="muted">Dates with a named month and four-digit year, or YYYY-MM-DD, are filled in. Check numeric dates and missing years yourself; no year or medical meaning is guessed. Each block keeps its exact original words.</Copy>
        {items.map((row) => <Card key={row.id} style={{ gap: 10 }}>
          <Copy kind="small" tone="muted">Original characters {row.start + 1}–{row.end}</Copy>
          <Choice label="Save this item" selected={row.selected} onPress={() => change(row.id, { selected: !row.selected })} />
          {!!family && <Choice label="Share this item with family" selected={row.shared} onPress={() => change(row.id, { shared: !row.shared })} />}
          <FilterChips label="Type" value={row.kind} options={[{ label: "Visit", value: "event" }, { label: "Moment", value: "journal" }]} onChange={(kind) => change(row.id, { kind: kind as Candidate["kind"], ...(row.title === "Prenatal visit" && kind === "journal" ? { title: "Pregnancy moment" } : row.title === "Pregnancy moment" && kind === "event" ? { title: "Prenatal visit" } : {}) })} />
          <Field label="Date (YYYY-MM-DD)" value={row.day} onChange={(day) => change(row.id, { day })} />
          <Field label="Title" value={row.title} maxLength={240} onChange={(title) => change(row.id, { title })} />
          {row.kind === "event" && <Field label="Clinic’s stated week (optional)" value={row.age} maxLength={120} onChange={(age) => change(row.id, { age })} />}
          <Field label="Words to save" multiline value={row.text} onChange={(text) => change(row.id, { text })} />
        </Card>)}
        <Button title="Confirm selected items" busy={busy} onPress={() => void confirm()} />
        <Button secondary title="Back to original" disabled={busy} onPress={() => setItems(null)} />
      </>}
    </>}
  </Screen>;
}
