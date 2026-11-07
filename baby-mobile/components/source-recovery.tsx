import { useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { ensureAiConsent } from "@/lib/ai-consent";
import { withoutRefusedRetry } from "../lib/outbox";
import { importFinished } from "../lib/import-status";
import { type BabyRecord, messageFor } from "@/lib/models";
import { isCaregiver } from "@/lib/spaces";
import { Button, Copy, Notice, Section, useToast } from "./ui";

export function SourceRecovery({ record, onError }: { record: BabyRecord; onError: (error: string) => void }) {
  const b = useBaby(), toast = useToast(), reading = useRef(false), [busy, setBusy] = useState(false);
  const data = record.data;
  if (record.kind !== "source" || record.cache_partial || isCaregiver(b.state.bootstrap)
      || !["saved", "incomplete", "failed", "cancelled", "ready"].includes(data.status ?? "")) return null;
  const refused = b.state.outbox.filter((item) => item.type === "import" && item.record_id === record.id && item.error);
  const queued = b.state.outbox.some((item) => item.type === "import" && item.record_id === record.id && !item.error)
    || b.state.imports.some((item) => item.record_id === record.id && !importFinished(item.status));
  const label = data.status === "ready" ? "Process this post again" : data.status === "saved" ? "Read with AI" : "Try again";
  const hasSource = !!(data.url || data.attachment_ids?.length || record.body.trim() || data.source_text?.trim());
  async function read() {
    if (reading.current || queued || !b.state.bootstrap) return;
    reading.current = true;
    setBusy(true);
    onError("");
    try {
      if (!await ensureAiConsent(b)) return;
      await b.queue({ id: Crypto.randomUUID(), type: "import", record_id: record.id,
        attachment_ids: data.attachment_ids, generation: b.state.bootstrap.generation, url: data.url,
        // Earlier captions and AI labels are not a parent's note.
        text: (data.url || data.attachment_ids?.length) ? record.body || data.user_text || undefined
          : [record.body, data.source_text].filter(Boolean).join("\n\n") || undefined,
        files: [], child_id: record.child_id, topics: data.topics });
      toast("Original preserved. Processing is queued.");
    } catch (error) {
      onError(messageFor(error));
    } finally {
      reading.current = false;
      setBusy(false);
    }
  }
  async function clearRefusal() {
    try {
      for (const item of refused) await b.commit((state) => withoutRefusedRetry(state, item.id));
      onError("");
    } catch (error) { onError(messageFor(error)); }
  }
  return <Section title={data.status === "ready" ? "Read again" : "Read this post"}>
    {refused.map((item) => <Notice error key={item.id}>{item.error}</Notice>)}
    {!!refused.length && <Button variant="ghost" title="Clear processing request" onPress={() => void clearRefusal()} />}
    {hasSource && <Button secondary title={queued ? "Waiting to process" : label} icon="sparkles-outline"
      busy={busy || queued} disabled={busy || queued || !!refused.length} onPress={() => void read()} />}
    <Button secondary title="Add screenshots or missing text" icon="images-outline"
      disabled={busy}
      onPress={() => router.push({ pathname: "/edit", params: { id: record.id, kind: "source" } })} />
    <Copy kind="small" tone="muted">{hasSource
      ? `Add screenshots or notes, choose Save changes, then return here and tap ${label}. This updates the same saved post. Some posts may still be unreadable.`
      : "Add screenshots or source text and choose Save changes. You can then read it here."}</Copy>
  </Section>;
}
