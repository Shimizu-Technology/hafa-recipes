import { useEffect, useMemo, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { Button, Copy, Field, Notice, Screen } from "@/components/ui";
import { CalendarDate } from "@/components/calendar-date";
import { useTraining } from "@/lib/context";
import { createPrivateForm } from "@/lib/private-form";
import { dateInTimezone } from "@/lib/training";
import { scheduleOnceCommand, type ScheduleOnceCommand } from "@/lib/schedule-once";
interface Input { date: string; time: string }
export default function ScheduleOnce() {
  const { workout_id = "" } = useLocalSearchParams<{ workout_id: string }>();
  const { api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const scope = `${owner}:${generation}:${workout_id}`;
  const live = useRef(scope); live.current = scope;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const form = useMemo(() => createPrivateForm<Input, ScheduleOnceCommand>(storage, owner, `schedule-once:${generation}:${workout_id}`), [storage, owner, generation, workout_id]);
  const cache = useQueryClient();
  const workout = useQuery({ queryKey: [owner, "workout", workout_id, generation], queryFn: () => api.workout(workout_id), enabled: !!enrollment?.enrolled });
  const [input, setInput] = useState<Input | null>(null);
  const [command, setCommand] = useState<ScheduleOnceCommand | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  function guard() { if (!mounted.current || live.current !== scope || !storage.isCurrent() || !isCurrentAccount()) throw Error("Your account changed. Reopen this workout to schedule it."); }
  useEffect(() => {
    let active = true;
    setInput(null); setCommand(null); setSaved(false);
    void form.load().then(box => {
      if (!active) return;
      setSaved(box.terminal); setCommand(box.command);
      setInput(box.input ?? { date: dateInTimezone(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone), time: "" });
    }).catch(() => { if (active) setError("Could not restore the schedule draft. Reopen before saving."); });
    return () => { active = false; };
  }, [form]);
  function update(patch: Partial<Input>) {
    if (!input || busy || command || saved) return;
    const next = { ...input, ...patch }; setInput(next);
    void form.save(next).catch(() => setError("Could not keep this date on your device. Stay here and retry."));
  }
  async function save() {
    if (!input || !workout.data || lock.current || saved) return;
    lock.current = true; setBusy(true); setError("");
    try {
      guard();
      const frozen = command ?? scheduleOnceCommand(workout.data, input.date, input.time, Crypto.randomUUID());
      await form.begin(input, frozen); guard(); setCommand(frozen);
      const result = await api.scheduleOnce(frozen, generation); guard();
      await form.complete(frozen, result.id); guard(); setSaved(true);
      await cache.invalidateQueries({ queryKey: [owner, "programs"] });
    } catch (e) { if (mounted.current && live.current === scope) setError((e as Error).message); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function scheduleAnother() {
    if (lock.current || !saved) return;
    lock.current = true; setBusy(true);
    try {
      guard();
      const next = { date: dateInTimezone(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone), time: "" };
      await form.reopen(next); guard();
      setInput(next); setCommand(null); setSaved(false); setError("");
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <Screen dismiss title="Schedule" subtitle={workout.data?.title}
    footer={!saved && input && workout.data ? <Button title={command ? "Retry schedule" : "Save session"} busy={busy} onPress={() => void save()} /> : undefined}>
    {saved ? <><Notice>Session scheduled.</Notice><Button title="Open Train" onPress={() => router.replace("/(tabs)/plan")} /><Button title="Schedule another session" secondary busy={busy} onPress={() => void scheduleAnother()} /></> : <>
      {input && <>
        <CalendarDate label="Workout date" value={input.date} disabled={busy || !!command} onChange={date => update({ date: date ?? "" })} />
        <Field label="Time · HH:MM" optional placeholder="18:30" value={input.time} disabled={busy || !!command} onChange={time => update({ time })} />
        <Copy kind="small" tone="muted">One session, using this saved workout. Time is a local calendar label; it does not create a reminder.</Copy>
        {command && <Notice>Saved on this device. Retry sends the same session, so a lost connection won’t create another.</Notice>}
      </>}
      <Button title="Build a plan" secondary disabled={busy || !!command} onPress={() => router.push({ pathname: "/build-plan", params: { include: workout_id } })} />
    </>}
    {(error || workout.error) && <Notice error>{error || workout.error?.message}</Notice>}
  </Screen>;
}
