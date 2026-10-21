import { useState } from "react";
import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { importCardVisible, importFinished, importLabel, importProblem, importRetryable } from "@/lib/import-status";
import { messageFor } from "@/lib/models";
import { Button, Copy, Notice, Section } from "./ui";
import { Disclosure } from "./disclosure";

export function ImportUpdates() {
  const b = useBaby(), jobs = b.state.imports.filter((job) => importCardVisible(job.status, job.error));
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  async function update(id: string, action: "retry" | "cancel") {
    if (busy) return;
    setBusy(id); setError("");
    try {
      const fresh = await (action === "retry" ? b.api.retryJob(id, b.state.bootstrap!.generation)
        : b.api.cancelJob(id, b.state.bootstrap!.generation));
      await b.commit((s) => ({ ...s, imports: s.imports.map((job) => job.id === id ? fresh : job) }));
    } catch (failure) { setError(messageFor(failure)); }
    finally { setBusy(""); }
  }
  if (!jobs.length) return null;
  return <Disclosure title={`Processing & updates · ${jobs.length}`}>
    {!!error && <Notice error>{error}</Notice>}
    {jobs.map((job) => <Section key={job.id} title={b.records.find((r) => r.id === job.record_id)?.title || "Saved post"}>
      <Copy kind="small">{importLabel(job.status, job.error)}</Copy>
      {!!job.error && <Copy kind="small" tone="muted">{importProblem(job.error)}</Copy>}
      {!!job.record_id && <Button secondary title="Open saved post" onPress={() => router.push({ pathname: "/record/[id]", params: { id: job.record_id! } })} />}
      {importRetryable(job.status, job.error) && <Button secondary title="Retry processing" busy={busy === job.id}
        disabled={!!busy} onPress={() => void update(job.id, "retry")} />}
      {!importFinished(job.status) && <Button variant="ghost" title="Cancel processing" disabled={!!busy}
        onPress={() => void update(job.id, "cancel")} />}
    </Section>)}
  </Disclosure>;
}
