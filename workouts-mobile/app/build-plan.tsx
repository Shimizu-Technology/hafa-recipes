import { SavedSourcePicker } from "@/components/saved-source-picker";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, type ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Choice, Copy, Field, Notice, Screen, Segmented, useReducedMotion } from "@/components/ui";
import { ReadinessPicker, type Readiness } from "@/components/readiness-picker";
import { CalendarDate } from "@/components/calendar-date";
import { ProgramPreview } from "@/components/program-preview";
import { useTraining } from "@/lib/context";
import { dateInTimezone } from "@/lib/training";
import { isISODate } from "@/lib/sharing";
import { sourceChoiceErrors, type ProgramReceipt } from "@/lib/plans";
import { planWeekOptions, planWeeks } from "@/lib/plan-presentation";
interface Draft {
  generation: number;
  date: string;
  weeks: string;
  title: string;
  selected: string[];
  source_mode: "mixed" | "selected";
  minutes: Record<string, string>;
  custom_reviewed: boolean;
  receipt: ProgramReceipt | null;
}
export default function BuildPlan() {
  const { localDrafts, api, owner, enrollment } = useTraining();
  // A saved workout to start from (e.g. "Add to a plan" after saving from Discover).
  const { include } = useLocalSearchParams<{ include?: string }>();
  const generation = enrollment?.generation ?? 0;
  const scope = `plan-builder:${generation}`;
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: [owner, "profile", generation, "snapshot"],
    queryFn: api.profileSnapshot,
    enabled: !!enrollment?.enrolled,
  });
  const [draft, setDraft] = useState<Draft>({
    generation,
    date: dateInTimezone(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone),
    weeks: "4",
    title: "My training plan",
    selected: [],
    source_mode: "mixed",
    minutes: {},
    custom_reviewed: false,
    receipt: null,
  });
  const [loaded, setLoaded] = useState(false);
  const [readiness, setReadiness] = useState<Readiness>("unknown");
  const [showSources, setShowSources] = useState(!!include);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(false);
  const scroller = useRef<ScrollView>(null);
  const reduceMotion = useReducedMotion();
  const proposalY = useRef<number | null>(null);
  const revealProposal = useRef(false);
  const profileMissing = !!enrollment?.enrolled && q.isSuccess && !q.data?.profile;
  const redirected = useRef(false);
  useEffect(() => {
    // No profile yet: go straight to the profile form, which returns here once saved.
    if (!profileMissing || redirected.current) return;
    redirected.current = true;
    router.replace({ pathname: "/profile", params: { return_to: "build-plan", ...(include ? { include } : {}) } });
  }, [profileMissing, include]);
  // A new proposal renders below the button. Once its position is known (now, or
  // when it first lays out), bring it into view and announce it.
  function revealIfReady() {
    if (!revealProposal.current || !draft.receipt || proposalY.current == null) return;
    revealProposal.current = false;
    scroller.current?.scrollTo({ y: Math.max(0, proposalY.current - 12), animated: !reduceMotion });
    AccessibilityInfo.announceForAccessibility?.(`Proposed program ready with ${draft.receipt.proposal.sessions.length} sessions. Review it below.`);
  }
  useEffect(() => {
    if (!draft.receipt) proposalY.current = null;
    else revealIfReady();
  });
  useEffect(() => {
    let active = true;
    void localDrafts
      .load<Draft>(owner, scope)
      .then((value) => {
        if (active) {
          const restored = value?.generation === generation ? value : null;
          if (restored) setDraft({ ...restored, weeks: planWeeks(restored.weeks) });
          if (restored?.selected.length) setShowSources(true);
          if (include && !(restored?.selected ?? []).includes(include))
            setDraft((current) => ({ ...current, selected: [...current.selected, include], receipt: null }));
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          if (include) setDraft((current) => (current.selected.includes(include) ? current : { ...current, selected: [...current.selected, include] }));
          setLoaded(true);
          setError("Could not restore your plan draft. You can review a new proposal.");
        }
      });
    return () => {
      active = false;
    };
  }, [owner, scope, generation, include]);
  useEffect(() => {
    if (loaded)
      void localDrafts
        .save(owner, scope, draft)
        .catch(() => setError("Could not keep this plan draft on the device. Stay here and retry."));
  }, [loaded, draft, owner, scope]);
  function update(patch: Partial<Draft>) {
    if (!busy) {
      const titleOnly = Object.keys(patch).length === 1 && "title" in patch;
      setDraft({ ...draft, ...patch, receipt: titleOnly ? draft.receipt : null });
      if (!titleOnly) setReviewed(false);
    }
  }
  async function run(work: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  async function propose() {
    const count = Number(draft.weeks);
    const problems = sourceChoiceErrors(draft.selected, draft.minutes);
    if (!Number.isInteger(count) || count < 1 || count > 12 || !isISODate(draft.date))
      problems.push("Choose 1–12 weeks and a valid start date.");
    if (draft.source_mode === "selected" && !draft.selected.length)
      problems.push("Pick at least one saved workout, or choose Mix with suggestions.");
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    await run(async () => {
      await api.setReadiness(readiness, generation);
      if (!q.data?.profile) throw Error("Set up your profile before building a program.");
      const source_minutes = Object.fromEntries(
        draft.selected.filter((id) => draft.minutes[id]?.trim()).map((id) => [id, Number(draft.minutes[id])])
      );
      const receipt = await api.proposeProgram(draft.date, count, q.data.revision, generation, {
        source_workout_ids: draft.selected,
        source_mode: draft.source_mode,
        reviewed_custom_routines: draft.custom_reviewed,
        source_minutes,
      });
      setDraft({ ...draft, receipt });
      setReviewed(false);
      revealProposal.current = true;
    });
  }
  async function accept() {
    if (!draft.receipt || !reviewed) return;
    await run(async () => {
      await api.acceptProgram(draft.receipt!.id, draft.title, draft.receipt!.generation);
      await localDrafts.remove(owner, scope);
      await cache.invalidateQueries({ queryKey: [owner, "programs"] });
      router.replace("/(tabs)/plan");
    });
  }
  if ((enrollment?.enrolled && q.isPending) || profileMissing) return <Screen back title="Build a plan"><Copy tone="muted">Loading your training preferences…</Copy></Screen>;
  if (!enrollment?.enrolled) return <Screen back title="Build a plan" subtitle="Plans use your goal, equipment and the days you can train.">
    <Button title="Join Workouts" onPress={() => router.push({ pathname: "/onboarding", params: { return_to: "build-plan", ...(include ? { include } : {}) } })} />
  </Screen>;
  return (
    <Screen
      back
      title="Build a plan"
      subtitle="Uses your goal, equipment and the days you can train."
      scrollRef={scroller}
    >
      {q.error && <Notice error>{q.error.message}</Notice>}
      {!q.data?.profile && (
        <Button title="Set up training profile" secondary onPress={() => router.push({ pathname: "/profile", params: { return_to: "build-plan", ...(include ? { include } : {}) } })} />
      )}
      <CalendarDate label="Start date" value={draft.date} disabled={busy} onChange={(date) => update({ date: date ?? "" })} />
      <Copy kind="label">How many weeks</Copy>
      <Segmented
        label="Plan length in weeks"
        value={draft.weeks}
        options={planWeekOptions(draft.weeks).map((weeks) => ({ value: weeks, label: weeks }))}
        onChange={(weeks) => update({ weeks })}
      />
      <Button
        title={showSources ? "Hide saved workouts" : draft.selected.length ? `Saved workouts · ${draft.selected.length} selected` : "Include my saved workouts"}
        variant="ghost" size="sm" inline icon={showSources ? "chevron-up" : "chevron-down"} disabled={busy}
        onPress={() => setShowSources(!showSources)}
      />
      {showSources && (
        <>
          <Segmented
            label="What the plan uses"
            value={draft.source_mode}
            options={[{ value: "mixed", label: "Mix with suggestions" }, { value: "selected", label: "Only these" }]}
            onChange={(source_mode) => update({ source_mode })}
          />
          <Copy kind="small" tone="muted">Pick up to 10. Anything missing, like sets or equipment, shows up as a question in the proposal.</Copy>
          <SavedSourcePicker
            selected={draft.selected}
            minutes={draft.minutes}
            change={(selected, minutes) => update({ selected, minutes })}
            disabled={busy}
          />
          <Choice
            label="These workouts are right for me"
            detail="You've checked the instructions. This isn't medical or fitness clearance."
            selected={draft.custom_reviewed}
            onPress={() => update({ custom_reviewed: !draft.custom_reviewed })}
          />
        </>
      )}
      <ReadinessPicker
        value={readiness}
        onChange={(value) => {
          if (!busy) {
            setReadiness(value);
            setDraft({ ...draft, receipt: null });
            setReviewed(false);
          }
        }}
      />
      <Button
        title={draft.receipt ? "Make a new proposal" : "Propose my plan"}
        variant={draft.receipt ? "secondary" : "primary"}
        busy={busy}
        disabled={!loaded || !q.data?.profile || !enrollment?.enrolled}
        onPress={() => {
          void propose();
        }}
      />
      {draft.receipt && (
        <>
          <View onLayout={(event) => { proposalY.current = event.nativeEvent.layout.y; revealIfReady(); }} />
          <ProgramPreview receipt={draft.receipt} />
          {draft.receipt.proposal.status === "ready" ? (
            <>
              <Field label="Plan name" value={draft.title} onChange={(title) => update({ title })} />
              <Choice
                label="I've looked over these sessions and notes"
                selected={reviewed}
                onPress={() => setReviewed(!reviewed)}
              />
              <Button
                title="Add to my plan"
                busy={busy}
                disabled={!reviewed || !draft.title.trim()}
                onPress={() => {
                  void accept();
                }}
              />
            </>
          ) : (
            <Button title="Update training profile" secondary onPress={() => router.push("/profile")} />
          )}
        </>
      )}
      {!!error && (
        <>
          <Notice error>{error}</Notice>
          <Button
            title="Reload my profile"
            variant="ghost"
            size="sm"
            inline
            disabled={busy}
            onPress={() => {
              void q.refetch();
              update({});
            }}
          />
        </>
      )}
    </Screen>
  );
}
