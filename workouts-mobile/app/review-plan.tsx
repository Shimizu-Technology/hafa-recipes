import { isISODate } from "@/lib/sharing";
import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Field, ListGroup, ListRow, Notice, Screen } from "@/components/ui";
import { ReadinessPicker, type Readiness } from "@/components/readiness-picker";
import { daysBetween, nextOffset, sessionDate } from "@/lib/plan-dates";
import { ProgramPreview, PrescriptionPreview } from "@/components/program-preview";
import { QueryState } from "@/components/query-state";
import { CalendarDate } from "@/components/calendar-date";
import { useTraining } from "@/lib/context";
import { dateInTimezone } from "@/lib/training";
import { sourceDayErrors, type ProgramReceipt } from "@/lib/plans";
import { goalLabels } from "@/lib/models";
interface DayDraft {
  day_offset: string;
  /** The chosen calendar date; older drafts only have `day_offset`. */
  date?: string;
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
  const [readiness, setReadiness] = useState<Readiness>("unknown");
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
    if (isSource && !isISODate(draft.date)) {
      setError("Choose a start date.");
      return;
    }
    const offsets = draft.days.map((day) => day.date != null ? daysBetween(draft.date, day.date) : sessionDate(draft.date, day.day_offset) ? Number(day.day_offset) : null);
    if (isSource && offsets.some((offset) => offset == null)) {
      setError("Choose a date for each session.");
      return;
    }
    if (offsets.some((offset) => offset != null && offset < 0)) {
      setError("Session dates can't be before the start date.");
      return;
    }
    const days = draft.days.map((day, index) => ({
      label: day.label,
      block_ids: day.block_ids,
      day_offset: offsets[index] ?? NaN,
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
      setError("Choose a valid date for each planned session.");
      return;
    }
    const invalid = Object.values(draft.minutes).some(
      (value) => value.trim() && (!Number.isInteger(Number(value)) || Number(value) < 5 || Number(value) > 180)
    );
    if (invalid) {
      setError("Session lengths must be whole minutes from 5 to 180.");
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
  const dayDate = (day: DayDraft) => day.date ?? (draft ? sessionDate(draft.date, day.day_offset) : null) ?? "";
  const changeDay = (index: number, patch: Partial<DayDraft>) =>
    draft && update({ days: draft.days.map((value, i) => (i === index ? { ...value, ...patch } : value)) });
  return (
    <Screen
      back
      title={isSource ? "Schedule this workout" : "Fit this plan to you"}
      subtitle={isSource ? "Choose which parts happen on which days." : "Check the dates and times before it becomes active."}
    >
      <QueryState hasData={loaded && (isSource ? source.data !== undefined : program.data !== undefined) && profile.data !== undefined}
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
            <ListGroup>
              <ListRow
                icon="person-outline"
                title="Training profile"
                detail={current
                  ? [goalLabels[current.primary_goal], current.session_minutes ? `${current.session_minutes} min` : null,
                    current.equipment?.join(", ") || (current.equipment?.length === 0 ? "Bodyweight" : null)].filter(Boolean).join(" · ")
                  : "Not set up yet"}
                onPress={() => router.push("/profile")}
              />
            </ListGroup>
            {isSource && source.data ? (
              <>
                <Copy kind="small" tone="muted">Nothing is guessed from the creator's program. Missing sets, weights or equipment stay blank.</Copy>
                <PrescriptionPreview workout={source.data} />
                <CalendarDate label="Start date" value={draft.date} disabled={busy} onChange={(date) => update({ date: date ?? "" })} />
                {draft.days.map((day, index) => (
                  <Card key={index}>
                    <Field label="Session name" value={day.label} onChange={(label) => changeDay(index, { label })} />
                    <CalendarDate label={`Date for ${day.label.trim() || `session ${index + 1}`}`} value={dayDate(day)} min={draft.date} disabled={busy}
                      onChange={(date) => changeDay(index, { date: date ?? "" })} />
                    <Field
                      label="Session length · minutes"
                      numeric
                      value={day.duration_minutes}
                      onChange={(duration_minutes) => changeDay(index, { duration_minutes })}
                    />
                    <Copy kind="label">Parts of the workout</Copy>
                    {source.data!.blocks.map((block) => (
                      <Choice
                        key={block.id}
                        label={block.label}
                        detail={block.exercises.map((e) => e.name).join(", ")}
                        selected={day.block_ids.includes(block.id)}
                        onPress={() => changeDay(index, {
                          block_ids: day.block_ids.includes(block.id)
                            ? day.block_ids.filter((id) => id !== block.id)
                            : [...day.block_ids, block.id],
                        })}
                      />
                    ))}
                    <Button
                      title={`Remove ${day.label || "this session"}`}
                      variant="ghost"
                      size="sm"
                      inline
                      icon="trash-outline"
                      disabled={busy}
                      onPress={() => update({ days: draft.days.filter((_, i) => i !== index) })}
                    />
                  </Card>
                ))}
                <Button
                  title="Add a session"
                  icon="add"
                  secondary
                  disabled={busy || draft.days.length >= 366}
                  onPress={() => {
                    const day_offset = nextOffset(draft.days.map((day) => day.date != null ? String(daysBetween(draft.date, day.date) ?? "") : day.day_offset));
                    update({
                      days: [
                        ...draft.days,
                        // New sessions get a real date, the day after the latest one.
                        { day_offset, date: sessionDate(draft.date, day_offset) ?? undefined, label: `Session ${draft.days.length + 1}`, duration_minutes: "", block_ids: [] },
                      ],
                    });
                  }}
                />
              </>
            ) : (
              <>
                {program.data?.questions.map((question, index) => (
                  <Notice key={index}>{question}</Notice>
                ))}
                <Copy kind="small" tone="muted">Change only what you need. Dates are checked against the days you can train and your recovery.</Copy>
                {program.data?.sessions.map((session) => (
                  <Card key={session.id}>
                    <Copy kind="heading">{session.workout.title}</Copy>
                    <PrescriptionPreview workout={session.workout} />
                    <CalendarDate
                      label="Date"
                      value={draft.dates?.[session.id] ?? session.date}
                      disabled={busy}
                      onChange={(date) => update({ dates: { ...draft.dates, [session.id]: date ?? "" } })}
                    />
                    <Field
                      label="Session length · minutes"
                      value={draft.minutes[session.id] ?? ""}
                      onChange={(value) => update({ minutes: { ...draft.minutes, [session.id]: value } })}
                      numeric
                      optional
                      placeholder={session.workout.estimated_minutes ? String(session.workout.estimated_minutes) : "Not specified"}
                    />
                  </Card>
                ))}
                <Copy kind="small" tone="muted">The original and its credit stay as they are. Sessions you've already done don't change.</Copy>
              </>
            )}
            <Choice
              label="These workouts are right for me"
              detail="You've checked the instructions. This isn't medical or fitness clearance."
              selected={draft.custom_reviewed}
              onPress={() => update({ custom_reviewed: !draft.custom_reviewed })}
            />
            <ReadinessPicker
              value={readiness}
              onChange={(value) => {
                if (!busy) {
                  setReadiness(value);
                  update({});
                }
              }}
            />
            <Button
              title={draft.receipt ? "Make a new proposal" : "Propose my plan"}
              variant={draft.receipt ? "secondary" : "primary"}
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
                    <Field label="Plan name" value={draft.title} onChange={(title) => update({ title })} />
                    <Choice
                      label="I've looked over these sessions and changes"
                      selected={reviewed}
                      onPress={() => setReviewed(!reviewed)}
                    />
                    <Button
                      title={isSource ? "Save this plan" : "Use this plan"}
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
            title="Reload and try again"
            variant="ghost"
            size="sm"
            inline
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
