import { useState } from "react";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { messageFor, type BabyRecord } from "@/lib/models";
import { duration } from "@/lib/care-format";
import { feedLengthAt, suggestedFeedEnd, validFeedEnd } from "@/lib/feed-reducer";
import { DateField } from "./date-field";
import { Button, Copy, Notice, useToast } from "./ui";

/**
 * "It ended at…" for a feed nobody finished: a suggested time she can change, and how long that makes the feed,
 * so a wrong save is obvious before she taps Save. `strong` makes it the page's main action.
 */
export function FeedEnded({ record, timeZone, strong }: { record: BabyRecord; timeZone?: string | null; strong?: boolean }) {
  const b = useBaby(), toast = useToast(), [at, setAt] = useState<string | null>(null),
    [busy, setBusy] = useState(false), [error, setError] = useState(""),
    length = at ? feedLengthAt(record, at) : undefined;
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
  if (!at) return <Button secondary={!strong} title="It ended at…" onPress={() => { setError(""); setAt(suggestedFeedEnd(record)); }} />;
  return <>
    <Copy>Suggested time. Change it if it’s wrong, then save.</Copy>
    <DateField label="It ended at" value={at} onChange={setAt} timeZone={timeZone} maximumDate={new Date()} />
    {length != null && <Copy kind="label" numeric>{`That makes a ${duration(length)} feed.`}</Copy>}
    {!!error && <Notice error>{error}</Notice>}
    <Button title="Save end time" busy={busy} onPress={() => void save()} />
    <Button secondary title="Still feeding / Cancel" disabled={busy} onPress={() => { setError(""); setAt(null); }} />
  </>;
}
