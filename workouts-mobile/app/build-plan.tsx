import { SavedSourcePicker } from "@/components/saved-source-picker";
import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Field, Notice, Screen } from "@/components/ui";
import { ProgramPreview } from "@/components/program-preview";
import { useTraining } from "@/lib/context";
import { dateInTimezone } from "@/lib/training";
import { isISODate } from "@/lib/sharing";
import { sourceChoiceErrors, type ProgramReceipt } from "@/lib/plans";
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
  const [readiness, setReadiness] = useState<"ready" | "limited" | "unknown">("unknown");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(false);
  useEffect(() => {
    let active = true;
    void localDrafts
      .load<Draft>(owner, scope)
      .then((value) => {
        if (active) {
          if (value?.generation === generation) setDraft(value);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setLoaded(true);
          setError("Could not restore your plan draft. You can review a new proposal.");
        }
      });
    return () => {
      active = false;
    };
  }, [owner, scope, generation]);
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
      problems.push("Choose saved sessions for a source-only plan.");
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
  return (
    <Screen
      back
      title="Build a routine that fits."
      subtitle="Your saved inspiration, current equipment and available days."
    >
      {q.error && <Notice error>{q.error.message}</Notice>}
      {!q.data?.profile && (
        <Button title="Set up training profile" secondary onPress={() => router.push("/onboarding")} />
      )}
      <Field label="Plan name" value={draft.title} onChange={(title) => update({ title })} />
      <Field label="Start date · YYYY-MM-DD" value={draft.date} onChange={(date) => update({ date })} />
      <Field label="Length · weeks" value={draft.weeks} numeric onChange={(weeks) => update({ weeks })} />
      <Card>
        <Copy kind="heading">What should your plan use?</Copy>
        <Choice
          label="Blend selected sessions with suitable generated training"
          selected={draft.source_mode === "mixed"}
          onPress={() => update({ source_mode: "mixed" })}
        />
        <Choice
          label="Use only the saved sessions I select"
          selected={draft.source_mode === "selected"}
          onPress={() => update({ source_mode: "selected" })}
        />
        <Copy>Select up to 10 sessions. Missing source targets or equipment remain questions for review.</Copy>
        <SavedSourcePicker
          selected={draft.selected}
          minutes={draft.minutes}
          change={(selected, minutes) => update({ selected, minutes })}
          disabled={busy}
        />
        <Choice
          label="I reviewed any custom routines I selected"
          detail="Confirm the instructions are appropriate for you; this does not provide medical or fitness clearance."
          selected={draft.custom_reviewed}
          onPress={() => update({ custom_reviewed: !draft.custom_reviewed })}
        />
      </Card>
      <Copy kind="heading">Quick check-in for today</Copy>
      {(["ready", "limited", "unknown"] as const).map((value) => (
        <Choice
          key={value}
          label={
            value === "ready"
              ? "Ready for general training"
              : value === "limited"
                ? "I need to take it easier"
                : "Prefer not to say / unsure"
          }
          selected={readiness === value}
          onPress={() => {
            if (!busy) {
              setReadiness(value);
              setDraft({ ...draft, receipt: null });
              setReviewed(false);
            }
          }}
        />
      ))}
      <Notice>This explicit current check-in expires. It is separate from your lasting profile.</Notice>
      <Button
        title="Review a proposed program"
        busy={busy}
        disabled={!loaded || !q.data?.profile || !enrollment?.enrolled}
        onPress={() => {
          void propose();
        }}
      />
      {draft.receipt && (
        <>
          <ProgramPreview receipt={draft.receipt} />
          {draft.receipt.proposal.status === "ready" ? (
            <>
              <Choice
                label="I reviewed all session prescriptions, assumptions and warnings"
                selected={reviewed}
                onPress={() => setReviewed(!reviewed)}
              />
              <Button
                title="Add this program to my plan"
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
            title="Refresh saved profile context"
            secondary
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
