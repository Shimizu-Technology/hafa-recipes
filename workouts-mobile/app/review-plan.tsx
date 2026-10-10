import { isISODate } from "@/lib/sharing";
import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Field, Notice, Screen } from "@/components/ui";
import { ProgramPreview, PrescriptionPreview } from "@/components/program-preview";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import { dateInTimezone } from "@/lib/training";
import { sourceDayErrors, type ProgramReceipt } from "@/lib/plans";
import { goalLabels } from "@/lib/models";
interface DayDraft {
  day_offset: string;
  block_ids: string[];
  label: string;
  duration_minutes: string;
}
interface Draft {
  generation: number;
  record_revision: number;
  profile_revision: number;
  date: string;
  title: string;
  days: DayDraft[];
  minutes: Record<string, string>;
  dates?: Record<string, string>;
  custom_reviewed: boolean;
  receipt: ProgramReceipt | null;
}
export default function ReviewPlan() {
  const params = useLocalSearchParams<{ workout_id?: string; program_id?: string }>();
  const isSource = !!params.workout_id;
  const id = params.workout_id ?? params.program_id ?? "";
  const { localDrafts, api, owner, enrollment } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const scope = `plan-review:${isSource ? "source" : "copy"}:${id}:${generation}`;
  const cache = useQueryClient();
  const profile = useQuery({
    queryKey: [owner, "profile", generation, "snapshot"],
    queryFn: api.profileSnapshot,
    enabled: !!enrollment?.enrolled,
  });
  const source = useQuery({
    queryKey: [owner, "workout", id, generation],
    queryFn: () => api.workout(id),
    enabled: isSource && !!enrollment?.enrolled,
  });
  const program = useQuery({
    queryKey: [owner, "program", id, generation],
    queryFn: () => api.program(id),
    enabled: !isSource && !!enrollment?.enrolled,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
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
          setError("Could not restore the review draft. Saved source and plans are unchanged.");
        }
      });
    return () => {
      active = false;
    };
  }, [owner, scope, generation]);
  useEffect(() => {
    const record = isSource ? source.data : program.data;
    if (loaded && !draft && record && profile.data)
      setDraft({
        generation,
        record_revision: record.revision,
        profile_revision: profile.data.revision,
        date: dateInTimezone(new Date(), profile.data.profile?.timezone ?? "Pacific/Guam"),
        title: record.title,
        days: [],
        minutes: {},
        custom_reviewed: false,
        receipt: null,
      });
  }, [loaded, draft, source.data, program.data, profile.data, generation, isSource]);
  useEffect(() => {
    if (draft)
      void localDrafts
        .save(owner, scope, draft)
        .catch(() => setError("Could not persist these review choices locally. Stay here and retry."));
  }, [draft, owner, scope]);
  function update(patch: Partial<Draft>) {
    if (draft && !busy) {
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
    if (!draft) return;
    if (isSource && draft.days.some((day) => !day.day_offset.trim())) {
      setError("Specify the day offset for each session.");
      return;
    }
    const days = draft.days.map((day) => ({
      ...day,
      day_offset: Number(day.day_offset),
      duration_minutes: Number(day.duration_minutes),
    }));
    if (isSource && source.data) {
      const errors = sourceDayErrors(source.data, draft.date, days);
      if (errors.length) {
        setError(errors.join(" "));
        return;
      }
    }
    if (Object.values(draft.dates ?? {}).some((date) => !isISODate(date))) {
      setError("Choose valid planned dates in YYYY-MM-DD format.");
      return;
    }
    const invalid = Object.values(draft.minutes).some(
      (value) => value.trim() && (!Number.isInteger(Number(value)) || Number(value) < 5 || Number(value) > 180)
    );
    if (invalid) {
      setError("Reviewed session times must be whole minutes from 5 to 180.");
      return;
    }
    await run(async () => {
      await api.setReadiness(readiness, generation);
      const receipt = isSource
        ? await api.proposeSourceProgram(
            id,
            draft.record_revision,
            draft.profile_revision,
            draft.date,
            days,
            draft.custom_reviewed,
            generation
          )
        : await api.reviewCopiedProgram(
            id,
            draft.record_revision,
            draft.profile_revision,
            Object.fromEntries(
              Object.entries(draft.minutes)
                .filter(([, value]) => value.trim())
                .map(([key, value]) => [key, Number(value)])
            ),
            draft.custom_reviewed,
            generation,
            draft.dates
          );
      setDraft({ ...draft, receipt });
      setReviewed(false);
    });
  }
  async function accept() {
    if (!draft?.receipt || !reviewed) return;
    await run(async () => {
      await api.acceptProgram(draft!.receipt!.id, draft!.title, draft!.receipt!.generation);
      await localDrafts.remove(owner, scope);
      await cache.invalidateQueries({ queryKey: [owner, "programs"] });
      await cache.invalidateQueries({ queryKey: [owner, "program", id] });
      router.replace("/(tabs)/plan");
    });
  }
  const current = profile.data?.profile;
  return (
    <Screen
      back
      title={isSource ? "Give this source a schedule." : "Review this copied plan for you."}
      subtitle={
        isSource
          ? "Assign the original blocks to days explicitly."
          : "A private copy needs your current constraints before it can become active."
      }
    >
      <QueryState
        loading={!loaded || (isSource ? source.isPending : program.isPending) || profile.isPending}
        error={source.error ?? program.error ?? profile.error}
        retry={() => {
          void profile.refetch();
          if (isSource) void source.refetch();
          else void program.refetch();
        }}
      >
        {draft && (
          <>
            <Card>
              <Copy kind="heading">Your current planning context</Copy>
              <Copy>
                {current ? goalLabels[current.primary_goal] : "Training profile not set"} ·{" "}
                {current?.session_minutes ?? "unspecified"} minutes
              </Copy>
              <Copy>
                Available equipment ·{" "}
                {current?.equipment?.join(", ") || (current?.equipment?.length === 0 ? "Bodyweight" : "Unknown")}
              </Copy>
              <Copy>Profile timezone · {current?.timezone ?? "Unknown"}</Copy>
              <Button title="Inspect training profile" secondary onPress={() => router.push("/profile")} />
            </Card>
            <Field label="Plan title" value={draft.title} onChange={(title) => update({ title })} />
            {isSource && source.data ? (
              <>
                <Notice>
                  No day assignments, missing targets, loads or equipment are guessed from a creator’s program. Inspect
                  the original instructions and assign each session deliberately.
                </Notice>
                <PrescriptionPreview workout={source.data} />
                <Field label="First day · YYYY-MM-DD" value={draft.date} onChange={(date) => update({ date })} />
                {draft.days.map((day, index) => (
                  <Card key={index}>
                    <Field
                      label={`Session ${index + 1} label`}
                      value={day.label}
                      onChange={(label) =>
                        update({ days: draft.days.map((value, i) => (i === index ? { ...value, label } : value)) })
                      }
                    />
                    <Field
                      label="Days after the first day · 0 is the first day"
                      numeric
                      value={day.day_offset}
                      onChange={(day_offset) =>
                        update({ days: draft.days.map((value, i) => (i === index ? { ...value, day_offset } : value)) })
                      }
                    />
                    <Field
                      label="Reviewed approximate session duration · minutes"
                      numeric
                      value={day.duration_minutes}
                      onChange={(duration_minutes) =>
                        update({
                          days: draft.days.map((value, i) => (i === index ? { ...value, duration_minutes } : value)),
                        })
                      }
                    />
                    <Copy kind="label">Original source blocks in this session</Copy>
                    {source.data!.blocks.map((block) => (
                      <Choice
                        key={block.id}
                        label={block.label}
                        detail={block.exercises.map((e) => e.name).join(", ")}
                        selected={day.block_ids.includes(block.id)}
                        onPress={() =>
                          update({
                            days: draft.days.map((value, i) =>
                              i === index
                                ? {
                                    ...value,
                                    block_ids: value.block_ids.includes(block.id)
                                      ? value.block_ids.filter((id) => id !== block.id)
                                      : [...value.block_ids, block.id],
                                  }
                                : value
                            ),
                          })
                        }
                      />
                    ))}
                    <Button
                      title="Remove this day assignment"
                      secondary
                      disabled={busy}
                      onPress={() => update({ days: draft.days.filter((_, i) => i !== index) })}
                    />
                  </Card>
                ))}
                <Button
                  title="Add a day assignment"
                  secondary
                  disabled={busy || draft.days.length >= 366}
                  onPress={() =>
                    update({
                      days: [
                        ...draft.days,
                        {
                          day_offset: "0",
                          label: `Session ${draft.days.length + 1}`,
                          duration_minutes: "",
                          block_ids: [],
                        },
                      ],
                    })
                  }
                />
              </>
            ) : (
              <>
                {program.data?.questions.map((question, index) => (
                  <Notice key={index}>{question}</Notice>
                ))}
                {program.data?.sessions.map((session) => (
                  <Card key={session.id}>
                    <Copy kind="heading">
                      {session.date} · {session.workout.title}
                    </Copy>
                    <PrescriptionPreview workout={session.workout} />
                    <Field
                      label="Planned date · YYYY-MM-DD"
                      value={draft.dates?.[session.id] ?? session.date}
                      onChange={(date) => update({ dates: { ...draft.dates, [session.id]: date } })}
                    />
                    <Copy kind="small">
                      Only dates you edit are overridden. The proposed calendar will be checked against your
                      availability and recovery.
                    </Copy>
                    <Field
                      label="Reviewed approximate session duration · minutes"
                      value={draft.minutes[session.id] ?? ""}
                      onChange={(value) => update({ minutes: { ...draft.minutes, [session.id]: value } })}
                      numeric
                      optional
                      placeholder={
                        session.workout.estimated_minutes
                          ? String(session.workout.estimated_minutes)
                          : "Source time not specified"
                      }
                    />
                  </Card>
                ))}
                <Notice>
                  This review can change future prescriptions for your own constraints. Source versions and copied
                  attribution remain intact. Actual recorded sessions keep their original snapshots.
                </Notice>
              </>
            )}
            <Choice
              label="I reviewed the custom source routines for my own use"
              selected={draft.custom_reviewed}
              onPress={() => update({ custom_reviewed: !draft.custom_reviewed })}
            />
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
                    update({});
                  }
                }}
              />
            ))}
            <Button
              title="Review a proposal using my current constraints"
              busy={busy}
              disabled={!current}
              onPress={() => {
                void propose();
              }}
            />
            {draft.receipt && (
              <>
                <ProgramPreview receipt={draft.receipt} />
                {draft.receipt.proposal.status === "ready" && (
                  <>
                    <Choice
                      label="I reviewed all proposed prescriptions, changes and warnings"
                      selected={reviewed}
                      onPress={() => setReviewed(!reviewed)}
                    />
                    <Button
                      title={isSource ? "Save this dated program" : "Apply this review to my copied program"}
                      busy={busy}
                      disabled={!reviewed || !draft.title.trim()}
                      onPress={() => {
                        void accept();
                      }}
                    />
                  </>
                )}
              </>
            )}
          </>
        )}
      </QueryState>
      {!!error && (
        <>
          <Notice error>{error}</Notice>
          <Button
            title="Reload current context after reviewing the saved source"
            secondary
            busy={busy}
            onPress={() => {
              void run(async () => {
                const p = await profile.refetch();
                const record = isSource ? (await source.refetch()).data : (await program.refetch()).data;
                if (!draft || !p.data || !record)
                  throw Error("Current context was not available. Your draft is preserved.");
                setDraft({
                  ...draft,
                  record_revision: record.revision,
                  profile_revision: p.data.revision,
                  receipt: null,
                });
                setReviewed(false);
              });
            }}
          />
        </>
      )}
    </Screen>
  );
}
