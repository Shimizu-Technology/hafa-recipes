import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Copy, Notice, Row } from "./ui";
import { useTraining } from "@/lib/context";
import { canApplyCoach, needsReturnConfirmation, type CoachSummary, type CoachFocus } from "@/lib/coach";
import { describeChange, type ChangeSummary } from "@/lib/coach-changes";
import { coachRecovery, coachReturnParams } from "@/lib/coach-recovery";
import { coachActionNoun } from "@/lib/labels";

/**
 * One coach suggestion: its proposal, today's record it changes, and one-tap
 * Apply / Undo. The server keeps every guard (expiry, revisions, readiness,
 * history); this only removes the client-side checkboxes.
 */
export function useCoachSuggestion(id: string, generation: number, initial: CoachSummary["state"] = "proposed") {
  const { api, owner, enrollment } = useTraining();
  const current = !!enrollment?.enrolled && enrollment.generation === generation;
  const cache = useQueryClient();
  const action = useQuery({ queryKey: [owner, "coach-action", id, generation], queryFn: () => api.coachAction(id), enabled: current });
  const kind = action.data?.kind, target = action.data?.target_id;
  // "Before" only matters while the suggestion is still open; applied/undone cards skip these reads.
  const open = current && (initial === "proposed");
  const profile = useQuery({ queryKey: [owner, "profile", generation], queryFn: api.profile, enabled: open && (kind === "profile" || kind === "schedule") });
  const record = useQuery({
    queryKey: [owner, "coach-change-target", kind, target, generation],
    queryFn: async () => kind === "schedule" ? { program: await api.program(target!) } : { workout: await api.workout(target!) },
    enabled: open && !!target && (kind === "schedule" || kind === "adaptation" || kind === "progression"),
  });
  const [state, setState] = useState(initial);
  useEffect(() => setState(initial), [initial]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scope = `${owner}:${generation}:${id}`;
  const live = useRef<string | null>(null), lock = useRef(false);
  useLayoutEffect(() => { live.current = scope; lock.current = false; return () => { live.current = null; }; }, [scope]);
  const summary: ChangeSummary | null = action.data ? describeChange(action.data, { profile: profile.data, ...record.data }) : null;
  async function run(work: () => Promise<CoachSummary["state"]>) {
    if (!current || lock.current) return false;
    lock.current = true; setBusy(true); setError("");
    try {
      const next = await work();
      // The server has changed things even if this card closed meanwhile, so always refresh.
      const refresh = Promise.all(["programs", "program", "profile", "library", "coach-history", "coach-action-history"].map(key => cache.invalidateQueries({ queryKey: [owner, key] })));
      if (live.current !== scope) return false;
      setState(next);
      await refresh;
      return true;
    } catch (e) {
      const message = (e as Error).message;
      // The server needs today's check-in before most training changes; say where to do it.
      if (live.current === scope) setError(friendly(message));
      return false;
    } finally {
      if (live.current === scope) { lock.current = false; setBusy(false); }
    }
  }
  return {
    action, summary, state, busy, error, current,
    ready: !!action.data && current && canApplyCoach(action.data),
    /** A return also needs the full sets and reps on screen before the confirmation is sent. */
    needsFullReview: !!action.data && needsReturnConfirmation(action.data),
    apply: ({ title, shownPrescriptions = false }: { title?: string; shownPrescriptions?: boolean } = {}) => run(async () => {
      const data = action.data;
      if (!data || !canApplyCoach(data)) throw Error("This suggestion expired or needs more information. Ask Coach again.");
      const confirm = needsReturnConfirmation(data);
      if (confirm && !shownPrescriptions) throw Error("Review the sets and reps before resuming this plan.");
      return (await api.acceptCoachAction(id, title?.trim() || data.proposal.program?.title || "Training plan", confirm, generation)).state;
    }),
    undo: () => run(async () => (await api.undoCoachAction(id, generation)).state),
  };
}

/** Plain wording for the API's guard messages; anything else passes through. */
function friendly(message: string) {
  if (/after the pause/i.test(message)) return "Check in for today in Coach first, then apply. Resuming needs a check-in from after the pause.";
  if (/confirm readiness/i.test(message)) return "Check in for today in Coach first, then apply.";
  if (/current baseline in your profile/i.test(message)) return "Update your starting point in your profile first, then apply.";
  if (/context changed|needs information/i.test(message)) return "Your training changed since Coach suggested this. Ask Coach again for a fresh suggestion.";
  return message;
}

/** "Label: before → after" lines. Multi-line values (a session's exercises) stay readable. */
export function CoachChangeRows({ summary }: { summary: ChangeSummary }) {
  return <View style={{ gap: 8 }}>
    {summary.rows.map((row, index) => <View key={`${index}:${row.label}`} style={{ gap: 2 }}>
      <Copy kind="caption" tone="muted">{row.label}</Copy>
      <Copy kind="small">{row.before ? `${row.before} → ${row.after}` : row.after}</Copy>
    </View>)}
    {!summary.rows.length && <Copy kind="small" tone="muted">Open details to see everything this changes.</Copy>}
    {!!summary.note && <Copy kind="small" tone="muted">{summary.note}</Copy>}
  </View>;
}

/** Inline card under a coach reply: what changes, then Apply / Not now; Undo after applying. */
export function CoachSuggestionCard({ item, generation, notify, recovery }: {
  item: CoachSummary; generation: number;
  notify(text: string, undo?: () => void): void;
  recovery?: { focus: CoachFocus; disabled: boolean; blockedReason?: string; checkIn(): void; askAgain(): void };
}) {
  const s = useCoachSuggestion(item.proposal_id, generation, item.state);
  const [hidden, setHidden] = useState(false);
  const details = () => router.push({ pathname: "/coach-action/[id]", params: { id: item.proposal_id, generation: String(generation), state: s.state } });
  const undo = async () => { if (await s.undo()) notify("Change undone"); };
  const p = s.action.data?.proposal;
  const { api, owner } = useTraining();
  const needsInfo = s.state === "proposed" && p?.status === "needs_information";
  const profile = useQuery({ queryKey: [owner, "profile", generation, "snapshot"], queryFn: api.profileSnapshot, enabled: s.current && needsInfo });
  const checkIn = useQuery({ queryKey: [owner, "readiness", generation], queryFn: api.readiness, enabled: s.current && needsInfo });
  const help = needsInfo && !profile.error && !checkIn.error && s.action.data && profile.data?.profile && checkIn.data
    ? coachRecovery(s.action.data, profile.data.profile, profile.data.revision, checkIn.data) : null;
  // Opening details never sends anything, so a draft message or photo only blocks the other recovery steps.
  const recoveryBlocked = !!recovery?.disabled && help?.next !== "details";
  function recover() {
    if (!recovery || recoveryBlocked || !s.current || !help) return;
    if (help.next === "profile") router.push({ pathname: "/profile", params: { return_to: "coach", ...coachReturnParams(recovery.focus) } });
    else if (help.next === "check-in") recovery.checkIn();
    else if (help.next === "ask") recovery.askAgain();
    else details();
  }
  const title = s.summary?.title ?? `Suggested ${coachActionNoun(item.kind)} change`;
  if (hidden && s.state === "proposed") return <Row gap={4}>
    <Copy kind="small" tone="muted" style={{ flexShrink: 1 }}>Suggestion hidden: {title}</Copy>
    <Button title="Show" variant="ghost" size="sm" inline onPress={() => setHidden(false)} />
  </Row>;
  return <Card compact>
    <Copy kind="caption" tone="muted">
      {s.state === "accepted" ? "Applied" : s.state === "undone" ? "Undone" : p && !s.ready && p.status === "ready" ? "Expired" : needsInfo ? "More information needed" : "Suggested change"}
    </Copy>
    <Copy kind="label">{needsInfo ? "Coach needs a little more" : title}</Copy>
    {!s.current && <Copy kind="small" tone="muted">From an earlier Workouts setup. It can’t be applied now.</Copy>}
    {s.current && s.action.isPending && <Copy kind="small" tone="muted">Loading what this changes…</Copy>}
    {!!s.action.error && <Notice error>{s.action.error.message}</Notice>}
    {s.state === "proposed" && !needsInfo && s.summary && <CoachChangeRows summary={s.summary} />}
    {s.state === "proposed" && p && p.status !== "ready" && !needsInfo && <Copy kind="small" tone="muted">
      {p.questions?.[0] ?? p.warnings?.[0] ?? "Coach needs more information before this can be applied."}
    </Copy>}
    {needsInfo && s.current && <>
      {help ? help.lines.map(line => <Copy key={line} kind="small" tone="muted">{line}</Copy>) : !profile.error && !checkIn.error && <Copy kind="small" tone="muted">Checking your saved profile and today’s check-in…</Copy>}
      {(profile.error || checkIn.error) && <Notice error>Could not check your saved information. Try again.</Notice>}
      {(profile.error || checkIn.error) && <Button title="Try again" onPress={() => { void profile.refetch(); void checkIn.refetch(); }} />}
    </>}
    {needsInfo && recoveryBlocked && !!recovery?.blockedReason && <Copy kind="small" tone="muted">{recovery.blockedReason}</Copy>}
    {!!s.error && <Notice error>{s.error}</Notice>}
    <Row wrap gap={4}>
      {s.current && help && recovery && <Button title={help.title} inline disabled={recoveryBlocked}
        accessibilityHint={help.next === "ask" ? "Sends your original request again using your saved information" : undefined} onPress={recover} />}
      {s.state === "proposed" && s.ready && (s.needsFullReview
        ? <Button title="Review and apply" size="sm" inline onPress={details} />
        : <Button title="Apply" icon="checkmark" size="sm" inline busy={s.busy}
          onPress={() => { void s.apply().then(done => { if (done) notify("Change applied", () => { void undo(); }); }); }} />)}
      {s.state === "proposed" && <Button title="Not now" variant="ghost" size="sm" inline disabled={s.busy} onPress={() => setHidden(true)} />}
      {s.state === "accepted" && <Button title="Undo" icon="arrow-undo-outline" secondary size="sm" inline busy={s.busy} onPress={() => { void undo(); }} />}
      {!(s.current && help && recovery && help.next === "details") && <Button title="Details" variant="ghost" size="sm" inline onPress={details} />}
    </Row>
  </Card>;
}
