import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { Button, Card, Copy, Notice, Screen } from "@/components/ui";
import { PrescriptionPreview } from "@/components/program-preview";
import { useOfflineTraining, useTraining } from "@/lib/context";
import { summaryOf } from "@/lib/training";
import { createPrivateForm } from "@/lib/private-form";
import { canRecoverResult, type ResultRecoveryCommand } from "@/lib/result-recovery";

export default function RecoverResult() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { owner, enrollment } = useTraining();
  return <RecoveryScreen key={`${owner}:${enrollment?.generation ?? 0}:${id}`} id={id} />;
}
function RecoveryScreen({ id }: { id: string }) {
  const { owner, enrollment, api, storage, isCurrentAccount } = useTraining();
  const offline = useOfflineTraining(), cache = useQueryClient();
  const generation = enrollment?.generation ?? 0, identity = `${owner}:${generation}:${id}`;
  const form = useMemo(() => createPrivateForm<{ reviewed: true }, ResultRecoveryCommand>(storage, owner,
    `result-recovery:${generation}:${id}`), [storage, owner, generation, id]);
  const [command, setCommand] = useState<ResultRecoveryCommand | null>(null);
  const [savedId, setSavedId] = useState<string>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const mounted = useRef(true), live = useRef(identity), lock = useRef(false);
  useLayoutEffect(() => { live.current = identity; }, [identity]);
  const current = () => mounted.current && live.current === identity && storage.isCurrent() && isCurrentAccount();
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true; setLoaded(false); setCommand(null); setSavedId(undefined); setError("");
    void form.load().then(box => { if (active && current()) { setCommand(box.command); setSavedId(box.saved_id); setLoaded(true); } })
      .catch(() => { if (active && current()) setError("Could not restore this recovery. Reopen it before continuing."); });
    return () => { active = false; };
  }, [form, loadAttempt]);
  const item = offline.state.history.find(h => h.generation === generation &&
    (h.request.client_session_id === id || h.recovery_origin?.request.client_session_id === id));
  const original = item?.recovery_origin ?? item;
  const receipt = offline.state.recovery_receipts?.find(item => item.original_id === id);
  const resultId = savedId ?? receipt?.saved_id;
  function openResult(value: string) { if (current()) router.replace({ pathname: "/session/[id]", params: { id: value } }); }
  const allowed = !!item && (canRecoverResult(item) || !!item.recovery || !!item.recovery_origin);
  async function save() {
    if (!offline.store || !loaded || !allowed || !current() || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const prior = item!.recovery ?? (item!.recovery_origin?.request.client_session_id === id ? item!.recovered_with : undefined);
      const frozen = await form.begin({ reviewed: true }, command ?? {
        creation_key: prior?.creation_key ?? Crypto.randomUUID(),
        client_session_id: prior?.client_session_id ?? Crypto.randomUUID(),
      });
      if (!current()) return; setCommand(frozen);
      const savedId = await offline.store.recoverResult(id, frozen, api.saveWorkout, api.saveSession, current);
      if (!current()) return;
      await form.complete(frozen, savedId);
      if (!current()) return;
      await cache.invalidateQueries({ queryKey: [owner, "library"] });
      await cache.invalidateQueries({ queryKey: [owner, "sessions", generation] });
      if (current()) router.replace({ pathname: "/session/[id]", params: { id: savedId } });
    } catch (failure) { if (current()) setError((failure as Error).message); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  return <Screen back title="Recover this result." subtitle="Keep the work you recorded, even when its workout was removed.">
    {!offline.ready || !loaded ? <Copy>Loading the result saved on this device…</Copy> : !item || !original ?
      resultId ? <Button title="View saved result" onPress={() => openResult(resultId)} /> :
      <Notice>This local result is no longer available. Check Progress for its saved record.</Notice> : <>
      <Card><Copy kind="heading">{original.workout.title}</Copy>
        <Copy>{new Date(original.request.started_at).toLocaleString()} · {original.request.status}</Copy>
        <Copy>{original.request.actuals.filter(actual => actual.completed).length} completed sets</Copy>
        {original.request.actuals.slice(0, 6).map((actual, index) => <Copy key={index} kind="small">
          {original.workout.blocks.find(block => block.id === actual.block_id)?.exercises[actual.exercise_index]?.name} · {summaryOf(actual)}
        </Copy>)}
        {original.request.actuals.length > 6 && <Copy kind="small">{original.request.actuals.length - 6} more recorded sets will also be saved unchanged.</Copy>}
        {!!original.request.notes && <Copy>Session notes · {original.request.notes}</Copy>}
      </Card>
      {item.state === "synced" && item.synced_id ? <Button title="View saved result" onPress={() => openResult(item.synced_id!)} /> : <>
        <Notice>Review the preserved workout below. Saving restores it privately and saves your recorded result.
          Already saved results open directly. Your reps, times and notes stay as recorded. Nothing is shared.</Notice>
        <PrescriptionPreview workout={original.workout} />
        {allowed ? <Button title={command || item.recovery || item.recovery_origin ? "Continue saving recovered result" : "Save private workout and result"}
          busy={busy} onPress={() => { void save(); }} /> : <Notice>
          Try saving the original result again in Progress. Recovery becomes available when its source is confirmed missing.
        </Notice>}
      </>}
    </>}
    {!!offline.error && <><Notice error>{offline.error}</Notice>
      <Button title="Retry loading saved sessions" secondary onPress={offline.retry} /></>}
    {!loaded && !!error && <Button title="Retry loading recovery" secondary onPress={() => setLoadAttempt(value => value + 1)} />}
    {!!error && <Notice error>{error}</Notice>}
  </Screen>;
}
