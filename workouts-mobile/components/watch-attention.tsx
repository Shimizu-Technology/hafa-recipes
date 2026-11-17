import { useState } from "react";
import { Button, ButtonRow, Copy, ListRow, Notice, Card } from "./ui";
import type { WatchAttention } from "@/lib/watch-sync";
/** Keep the normal Today view quiet; expand only when someone asks to review. */
export function WatchAttentionRow({ items, discard }: { items: WatchAttention[]; discard(id: string): Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!items.length) return null;
  async function remove(id: string) {
    setBusy(true); setError("");
    try { await discard(id); setConfirm(null); } catch { setError("Could not discard this result. Try again."); }
    finally { setBusy(false); }
  }
  return <>
    <ListRow icon="watch-outline" title={`${items.length} watch ${items.length === 1 ? "result needs" : "results need"} attention`}
      detail={expanded ? "Hide details" : "Review results saved on this phone"} onPress={() => setExpanded(!expanded)} />
    {expanded && items.map((item, index) => <Card key={`${item.id}:${index}`} compact>
      <Copy kind="label">{item.title}</Copy><Copy kind="small" tone="muted">{item.reason}</Copy>
      {confirm === item.id ? <>
        <Copy kind="small">Discard this phone copy? It cannot be imported later. The workout in Health stays there.</Copy>
        <ButtonRow><Button title="Cancel" variant="secondary" disabled={busy} onPress={() => setConfirm(null)} />
          <Button title="Discard" variant="destructive" busy={busy} onPress={() => { void remove(item.id); }} /></ButtonRow>
      </> : item.discardable && <Button title="Discard result" variant="ghost" onPress={() => setConfirm(item.id)} />}
    </Card>)}
    {!!error && <Notice error>{error}</Notice>}
  </>;
}
