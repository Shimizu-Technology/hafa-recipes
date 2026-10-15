import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { Button, Card, Choice, Copy, Field, Notice, Screen } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import { createPrivateForm } from "@/lib/private-form";
import { updateImportReferences } from "@/lib/capture";
import { sourceRecoveryRequest, type SourceRecoveryCommand, type SourceRecoveryInput } from "@/lib/workout-source-recovery";

export default function RecoverWorkout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, owner, enrollment, storage, localDrafts, isCurrentAccount } = useTraining();
  const generation = enrollment?.generation ?? 0, scope = `source-recovery:${generation}:${id}`;
  const form = useMemo(() => createPrivateForm<SourceRecoveryInput, SourceRecoveryCommand>(storage, owner, scope), [storage, owner, scope]);
  const epoch = useMemo(() => ({}), [scope, owner, storage]);
  const live = useRef(epoch);
  useLayoutEffect(() => { live.current = epoch; }, [epoch]);
  const mounted = useRef(true), submitting = useRef(false);
  const [input, setInput] = useState<SourceRecoveryInput | null>(null);
  const [command, setCommand] = useState<SourceRecoveryCommand | null>(null);
  const [savedImport, setSavedImport] = useState<string>();
  const [loaded, setLoaded] = useState(false), [loadAttempt, setLoadAttempt] = useState(0);
  const [readyEpoch, setReadyEpoch] = useState<object | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const cache = useQueryClient();
  const enabled = !!enrollment?.enrolled;
  const workout = useQuery({ queryKey: [owner, "workout", id, generation], queryFn: () => api.workout(id), enabled });
  const capabilities = useQuery({ queryKey: [owner, "capabilities", generation], queryFn: api.capabilities, enabled });
  const consent = useQuery({ queryKey: [owner, "ai-consent", generation], queryFn: api.aiConsent, enabled });
  function current() {
    if (!mounted.current || live.current !== epoch || !storage.isCurrent() || !isCurrentAccount())
      throw Error("This workout or account changed. Recovery was stopped.");
  }
  function isCurrent() { try { current(); return true; } catch { return false; } }
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => {
    let active = true;
    submitting.current = false; setBusy(false);
    setLoaded(false); setInput(null); setCommand(null); setSavedImport(undefined); setError("");
    void form.load().then(box => {
      current(); if (!active) return;
      setInput(box.input); setCommand(box.command); setSavedImport(box.saved_id); setReadyEpoch(epoch); setLoaded(true);
    }).catch(() => { if (active && isCurrent()) setError("Could not restore this recovery draft. Try loading it again before continuing."); });
    return () => { active = false; };
  }, [form, loadAttempt, epoch]);
  useEffect(() => {
    if (loaded && !input && !command && !savedImport && workout.data)
      setInput({ source_url: workout.data.source_url ?? "", caption: "" });
  }, [loaded, input, command, savedImport, workout.data]);
  function update(patch: Partial<SourceRecoveryInput>) {
    if (!input || readyEpoch !== epoch || submitting.current || command || savedImport) return;
    try { current(); } catch { return; }
    const next = { ...input, ...patch }; setInput(next);
    void form.save(next).catch(() => { if (isCurrent()) setError("Could not keep this recovery draft on your device. Stay here until saved."); });
  }
  async function recover(agree: boolean) {
    if (!isCurrent() || submitting.current || !input || !loaded || readyEpoch !== epoch || !workout.data || !capabilities.data?.imports || !generation || savedImport) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      current();
      const source = command?.source ?? sourceRecoveryRequest(input);
      const checked = await api.aiConsent(); current();
      if (!checked.accepted || checked.disclosure_version !== 1) {
        if (!agree) { await consent.refetch(); current(); throw Error("AI preferences changed. Review the disclosure before recovering this source."); }
        await api.setAiConsent(true, generation); current();
        await consent.refetch(); current();
      }
      const target = input.update_existing !== false && capabilities.data.existing_workout_updates === true
        ? { workout_id: id, expected_revision: workout.data.revision } : undefined;
      const frozen = await form.begin(input, command ?? { request_id: Crypto.randomUUID(), source,
        auto_save: target ? false : capabilities.data.server_auto_save === true, ...(target ? { replace_target: target } : {}) });
      current(); setCommand(frozen);
      const job = await api.startImport(frozen.request_id, frozen.source, generation, { auto_save: frozen.auto_save, is_public: false,
        ...(frozen.replace_target ? { replace_target: frozen.replace_target } : {}) }); current();
      await localDrafts.save(owner, `import-visibility:${generation}:${job.id}`, false); current();
      await updateImportReferences(localDrafts, owner, generation, current, items => [
        { id: job.id, generation, label: frozen.source.source_url ?? "Workout from caption or transcript", auto_save: frozen.auto_save, created_at: new Date().toISOString() },
        ...items.filter(item => item.id !== job.id),
      ]); current();
      await form.complete(frozen, job.id); current(); setSavedImport(job.id); setCommand(null);
      await cache.invalidateQueries({ queryKey: [owner, "imports"] }); current();
      router.replace({ pathname: "/import/[id]", params: { id: job.id } });
    } catch (e) { if (isCurrent()) setError((e as Error).message); }
    finally { if (isCurrent()) { submitting.current = false; setBusy(false); } }
  }
  const locked = busy || readyEpoch !== epoch || !!command || !!savedImport;
  const needsConsent = !consent.data?.accepted || consent.data.disclosure_version !== 1;
  if (!enabled) return <Screen back title="Recover this workout."><Copy>Set up your Workouts account before recovering a saved source.</Copy>
    <Button title="Set up Workouts" onPress={() => router.push("/onboarding")} /></Screen>;
  return <Screen back title="Recover this workout." subtitle="Try the source again or paste its caption or transcript.">
    <QueryState loading={workout.isPending} error={workout.error} retry={() => { void workout.refetch(); }}>
      {workout.data && <Card compact><Copy kind="subheading">{workout.data.title}</Copy>
        <Copy kind="small">Review the extraction before updating this workout. Its earlier versions and recorded sessions stay saved. You can also save a separate copy.</Copy></Card>}
      {!loaded ? <Button title="Load recovery draft" secondary onPress={() => setLoadAttempt(value => value + 1)} /> : savedImport ?
        <Button title="Open recovery import" onPress={() => { if (isCurrent()) router.replace({ pathname: "/import/[id]", params: { id: savedImport } }); }} /> : input && <>
          <Field label="Original source link" purpose="url" optional value={input.source_url} onChange={source_url => update({ source_url })} disabled={locked} />
          <Field label="Creator caption or transcript" multiline optional value={input.caption} onChange={caption => update({ caption })} disabled={locked} />
          {capabilities.data?.existing_workout_updates && <Choice label="Update this saved workout after review" selected={input.update_existing !== false} disabled={locked}
            detail="Turn off to create a separate private copy instead." onPress={() => update({ update_existing: input.update_existing === false })} />}
          <Copy kind="small">Paste the creator’s actual instructions, including exercise names, reps, time and equipment. If the original upload is gone, the caption or transcript can be used on its own.</Copy>
          <Notice>Recovery sends this source to OpenAI. Your saved workout stays unchanged until you review and save the result. New copies stay private.</Notice>
          {command && <Notice>Your recovery request is saved on this device. Reconnect sends the same source and caption.</Notice>}
          <Button title={needsConsent ? "Agree and recover privately" : command ? "Reconnect recovery" : "Recover as a private import"} busy={busy}
            disabled={!capabilities.data?.imports || !workout.data || consent.isPending || !!consent.error}
            onPress={() => { void recover(needsConsent); }} />
          <Button title="Use photos or screenshots instead" variant="ghost" onPress={() => router.push("/capture")} />
        </>}
    </QueryState>
    {capabilities.error && <><Notice error>{capabilities.error.message}</Notice><Button title="Retry import availability" secondary onPress={() => { void capabilities.refetch(); }} /></>}
    {capabilities.data && !capabilities.data.imports && <Notice>Automatic importing is unavailable right now. Your saved draft stays safe; you can edit its details manually.</Notice>}
    {consent.error && <><Notice error>Could not check AI preferences.</Notice><Button title="Retry AI preferences" secondary onPress={() => { void consent.refetch(); }} /></>}
    {workout.data && <Button title="Edit saved draft instead" variant="ghost" onPress={() => router.push({ pathname: "/edit-workout/[id]", params: { id } })} />}
    {!!error && <Notice error>{error}</Notice>}
  </Screen>;
}
