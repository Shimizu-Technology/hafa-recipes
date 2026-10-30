import { dayAdjustments, type DayReceipt } from "@/lib/day-adjustments";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, Card, Choice, Copy, Field, Notice, Sheet } from "./ui";
import { ReadinessPicker, type Readiness } from "./readiness-picker";
import { PrescriptionPreview } from "./program-preview";
import { useTraining } from "@/lib/context";
import type { Program, ScheduledSession } from "@/lib/models";
export interface DayProposal { id: string; proposal: { status: string; warnings?: string[]; changes?: string[]; questions: string[]; state: string; session_ids: string[]; before: { proposal: { sessions: ScheduledSession[] } }; program: { proposal: { sessions: ScheduledSession[] } } } }
type Props = { visible: boolean; onClose(): void; program: Program; session?: ScheduledSession };
export function AdjustTraining(props: Props) {
  const { owner, enrollment } = useTraining();
  return <Adjustment key={`${owner}:${enrollment?.generation}:${props.program.id}:${props.session?.id ?? "missed"}`} {...props} />;
}
function Adjustment({ visible, onClose, program, session }: { visible: boolean; onClose(): void; program: Program; session?: ScheduledSession }) {
  const { api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const cache = useQueryClient();
  const store = useMemo(() => dayAdjustments(storage, owner, generation), [storage, owner, generation]);
  const [receipt, setReceipt] = useState<DayReceipt | null>(null);
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    setLoaded(false); setReceipt(null); setProposal(null); setState("proposed");
    void store.list().then(items => {
      if (!active || !storage.isCurrent() || !isCurrentAccount()) return;
      const saved = items.find(r => r.program.id === program.id && r.session?.id === session?.id);
      if (saved) { setReceipt(saved); setProposal(saved.proposal); setState(saved.state); }
      setLoaded(true);
    }).catch(() => { if (active && storage.isCurrent() && isCurrentAccount()) setError("Could not restore your saved adjustment. Reopen this sheet to retry; no new changes can be applied yet."); });
    return () => { active = false; mounted.current = false; };
  }, [store]);
  function guard() { if (!mounted.current || !isCurrentAccount() || !storage.isCurrent()) throw Error("Your account or training enrollment changed."); }
  async function saveReceipt(next: DayReceipt) {
    guard(); await store.save(next); guard(); setReceipt(next);
    void cache.invalidateQueries({ queryKey: [owner, "day-adjustments", generation] });
  }
  const profile = useQuery({ queryKey: [owner, "profile", generation, "snapshot"], queryFn: api.profileSnapshot, enabled: visible });
  const [minutes, setMinutes] = useState("15");
  const [easier, setEasier] = useState(false);
  const [readiness, setReadiness] = useState<Readiness>("unknown");
  const [proposal, setProposal] = useState<DayProposal | null>(null);
  const [state, setState] = useState("proposed");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function run(action: "preview" | "accept" | "undo") {
    if (lock.current || !loaded) return;
    lock.current = true; setBusy(true); setError("");
    try {
      guard();
      if (action === "preview") {
        if (!profile.data?.profile) throw Error("Add the training details needed for a personal adjustment first.");
        const value = easier ? Math.min(Number(minutes), Math.max(5, Math.floor((session?.workout.estimated_minutes ?? Number(minutes)) * 0.7))) : Number(minutes);
        if (session && (!/^\d+$/.test(minutes) || !Number.isInteger(value) || value < 5 || value > 180)) throw Error("Choose 5–180 whole minutes.");
        await api.setReadiness(readiness, generation);
        guard();
        const result = await api.previewDay({ program_id: program.id, program_revision: program.revision, profile_revision: profile.data.revision,
          ...(session ? { session_id: session.id, minutes: value } : {}) }, generation);
        guard(); setProposal(result); setState("proposed");
      } else if (proposal) {
        const saved: DayReceipt = { owner, generation, program, session, proposal, state, pending: action };
        await saveReceipt(saved); // Persist the exact proposal before any write can reach the server.
        const result = await api.applyDay(proposal.id, action, generation);
        guard();
        if (result.state === "undone") { await store.remove(saved); guard(); setReceipt(null); }
        else await saveReceipt({ ...saved, state: result.state, pending: null });
        setState(result.state);
        void cache.invalidateQueries({ queryKey: [owner, "day-adjustments", generation] });
        await cache.invalidateQueries({ queryKey: [owner, "programs"] });
      }
    } catch (e) {
      if (mounted.current && isCurrentAccount() && storage.isCurrent()) {
        setError((e as Error).message);
        if (action !== "preview" && proposal && [404, 409, 410].includes((e as { status?: number }).status ?? 0)) {
          const invalid = "This adjustment can no longer be applied or undone because its plan, recorded work or training context changed. Review the current plan.";
          const saved: DayReceipt = { owner, generation, program, session, proposal, state, pending: null, invalid };
          try { await saveReceipt(saved); } catch { setError("Could not save the conflict receipt. The original request is retained; reopen to check it."); }
        }
      }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <Sheet visible={visible} onClose={onClose} title={session ? "Adjust today" : "Missed sessions"}>
    {!proposal ? <>
      {session ? <>
        <Copy>{session.workout.title}</Copy>
        {([15, 30] as const).map(value => <Choice key={value} role="radio" label={`${value} minutes`} selected={minutes === String(value)} disabled={busy} onPress={() => setMinutes(String(value))} />)}
        <Field label="Custom minutes" numeric value={minutes} disabled={busy} onChange={setMinutes} />
        <Choice label="Take it easier" detail="Preview at most your selected minutes and about 70% of today's original time. No extra load or intensity is added." selected={easier} disabled={busy} onPress={() => setEasier(!easier)} />
      </> : <Copy>Find new dates for missed sessions in {program.title}. Other sessions and recorded work stay in place. Nothing moves until you Apply.</Copy>}
      <ReadinessPicker value={readiness} onChange={setReadiness} />
      {profile.isSuccess && !profile.data?.profile && <Button title="Add training details" secondary onPress={() => router.push("/profile")} />}
      <Button title="Preview changes" busy={busy} disabled={!loaded || readiness !== "ready" || profile.isPending} onPress={() => void run("preview")} />
    </> : <>
      {proposal.proposal.session_ids.map(id => {
        const before = proposal.proposal.before.proposal.sessions.find(s => s.id === id)!;
        const after = proposal.proposal.program.proposal.sessions.find(s => s.id === id)!;
        return <Card key={id} compact>
          <Copy kind="label">{before.workout.title}</Copy>
          <Copy>Before · {before.date} · {before.workout.estimated_minutes ?? "Unknown"} min</Copy>
          <Copy>After · {after.date} · {after.workout.estimated_minutes ?? "Unknown"} min</Copy>
          {!!session && <><Copy kind="label">Before</Copy><PrescriptionPreview workout={before.workout} /><Copy kind="label">After</Copy><PrescriptionPreview workout={after.workout} /></>}
        </Card>;
      })}
      {proposal.proposal.warnings?.map((warning, i) => <Notice key={`w${i}`}>{warning}</Notice>)}
      {proposal.proposal.changes?.map((change, i) => <Copy key={`c${i}`} kind="small">{change}</Copy>)}
      {proposal.proposal.questions.map((q, i) => <Notice key={i}>{q}</Notice>)}
      {receipt?.invalid ? <><Notice>{receipt.invalid}</Notice><Button title="Dismiss unavailable adjustment" secondary disabled={busy} onPress={() => {
        void store.remove(receipt).then(() => { guard(); setReceipt(null); setProposal(null); void cache.invalidateQueries({ queryKey: [owner, "day-adjustments", generation] }); }).catch(e => setError(e.message));
      }} /></> : receipt?.pending ? <><Notice>The last response was not confirmed. Check the saved request before making another adjustment.</Notice><Button title={receipt.pending === "accept" ? "Check Apply" : "Check Undo"} busy={busy} onPress={() => void run(receipt.pending!)} /></> : <>
      {state === "proposed" && <Button title="Apply" busy={busy} disabled={proposal.proposal.status !== "ready"} onPress={() => void run("accept")} />}
      {state === "accepted" && <><Notice>Changes applied.</Notice><Button title="Undo" secondary busy={busy} onPress={() => void run("undo")} /></>}
      {state === "undone" && <Notice>Original session details restored.</Notice>}
      {state !== "accepted" && <Button title="Review another adjustment" secondary disabled={busy} onPress={() => setProposal(null)} />}
      </>}
    </>}
    {!!(error || profile.error) && <Notice error>{error || profile.error?.message}</Notice>}
  </Sheet>;
}
