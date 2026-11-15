import { useState } from "react";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { messageFor, type BabyRecord } from "@/lib/models";
import { suggestedFeedEnd, validFeedEnd } from "@/lib/feed-reducer";
import { DateField } from "./date-field";
import { Button, Copy, Notice, useToast } from "./ui";

export function FeedEnded({ record, timeZone }: { record: BabyRecord; timeZone?: string | null }) {
  const b = useBaby(), toast = useToast(), [at, setAt] = useState<string | null>(null),
    [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save() {
    if (!at || busy) return;
    if (!validFeedEnd(record, at)) { setError("Choose a time after the last side tap and no later than now."); return; }
    setBusy(true); setError("");
    try {
      const id = Crypto.randomUUID();
      await b.queue({ id, generation: b.state.bootstrap!.generation, type: "feed_action", record_id: record.id,
        action: { id, action: "finish", at } });
      setAt(null); toast("Feed end saved.");
    } catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  }
  return <>
    <Button secondary title="It ended at…" onPress={() => setAt(suggestedFeedEnd(record))} />
    {at && <>
      <Copy>Suggested time — change it if needed, then save.</Copy>
      <DateField label="It ended at" value={at} onChange={setAt} timeZone={timeZone} maximumDate={new Date()} />
      {!!error && <Notice error>{error}</Notice>}
      <Button title="Save end time" busy={busy} onPress={() => void save()} />
      <Button secondary title="Still feeding / Cancel" disabled={busy} onPress={() => setAt(null)} />
    </>}
  </>;
}
