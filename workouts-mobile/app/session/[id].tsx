import { HealthExport } from "@/components/health-export";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { Button, Card, Choice, Copy, Field, IconButton, Notice, Screen } from "@/components/ui";
import { SessionTable } from "@/components/session-table";
import { QueryState } from "@/components/query-state";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { actualIdentity, historicalStructureWarning } from "@/lib/training";
import { friendlyDate } from "@/lib/progress-insights";
import { sessionStatusLabel } from "@/lib/labels";
import type { ActualSet } from "@/lib/models";
type NumericActual = "reps" | "duration_seconds" | "distance_meters" | "load" | "effort";
export default function SessionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, owner, units } = useTraining();
  const offline = useOfflineTraining();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: [owner, "session", id], queryFn: () => api.session(id) });
  const [editing, setEditing] = useState<ActualSet[] | null>(null);
  const [numericDraft, setNumericDraft] = useState<Record<number, Partial<Record<NumericActual, string>>>>({});
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!q.data || !editing || !offline.store) return;
    setBusy(true);
    try {
      const actuals = editing.map((actual, index) => {
        const result = { ...actual };
        for (const key of Object.keys(numericDraft[index] ?? {}) as NumericActual[]) {
          const value = numericDraft[index][key]!;
          result[key] = value.trim() ? Number(value) * (key === "distance_meters" && units === "imperial" ? 1609.344 : 1) : null;
        }
        return result;
      });
      await offline.store.correct(q.data, actuals, notes, Crypto.randomUUID());
      void offline.store.sync(api.saveSession).then(() => cache.invalidateQueries({ queryKey: [owner, "sessions"] }));
      router.replace("/(tabs)/progress");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function change(index: number, update: Partial<ActualSet>) {
    setEditing((old) => old?.map((actual, i) => (i === index ? { ...actual, ...update } : actual)) ?? null);
  }
  function numeric(actual: ActualSet, index: number, key: NumericActual) {
    const value = actual[key];
    return {
      value: numericDraft[index]?.[key] ?? (value == null ? "" : String(key === "distance_meters" && units === "imperial" ? value / 1609.344 : value)),
      onChange: (raw: string) => setNumericDraft((old) => ({ ...old, [index]: { ...old[index], [key]: raw } })),
    };
  }
  return (
    <Screen
      back
      title={q.data?.title ?? "Session"}
      subtitle={q.data ? [friendlyDate(q.data.started_at), sessionStatusLabel(q.data.status),
        q.data.content.active_seconds != null ? `${Math.round(q.data.content.active_seconds / 60)} min` : null].filter(Boolean).join(" · ") : undefined}
      action={q.data ? <IconButton icon="chatbubble-ellipses-outline" label="Chat about this session"
        onPress={() => router.push({ pathname: "/coach", params: { session_id: q.data!.id } })} /> : undefined}
    >
      <QueryState hasData={q.data !== undefined}
        loading={q.isPending}
        error={q.error}
        errorMessage="This session couldn’t load. Check your connection and try again."
        retry={() => {
          void q.refetch();
        }}
      >
        {q.data && (
          <>
            {!!historicalStructureWarning(q.data.content.prescription_snapshot, q.data.content.actuals) && (
              <Notice>{historicalStructureWarning(q.data.content.prescription_snapshot, q.data.content.actuals)}</Notice>
            )}
            {!editing && !!q.data.content.notes && (
              <Card compact tone="sunken">
                <Copy kind="label">Notes</Copy>
                <Copy>{q.data.content.notes}</Copy>
              </Card>
            )}
            {!editing && <SessionTable actuals={q.data.content.actuals} workout={q.data.content.prescription_snapshot} units={units} />}
            {!editing && <HealthExport sessionId={q.data.id} />}
            {editing?.map((a, index) => (
              <Card key={`${actualIdentity(a)}:${index}`}>
                <Copy kind="heading">
                  {
                    q.data!.content.prescription_snapshot.blocks.find((b) => b.id === a.block_id)?.exercises[
                      a.exercise_index
                    ]?.name
                  }
                </Copy>
                <Copy>
                  Round {a.round_index} · set {a.set_index}
                  {a.side ? ` · ${a.side}` : ""}
                </Copy>
                <>
                    <Field
                      label="Actual reps"
                      optional
                      numeric
                      {...numeric(a, index, "reps")}
                    />
                    <Field
                      label="Actual seconds"
                      optional
                      numeric
                      {...numeric(a, index, "duration_seconds")}
                    />
                    <Field
                      label={`Actual distance · ${units === "imperial" ? "miles" : "metres"}`}
                      optional numeric
                      {...numeric(a, index, "distance_meters")}
                    />
                    <Field
                      label={`Actual load · ${a.load_unit ?? "choose unit when adding load"}`}
                      optional
                      numeric
                      {...numeric(a, index, "load")}
                    />
                    {(numericDraft[index]?.load ?? (a.load == null ? "" : String(a.load))).trim() !== "" && (
                      <>
                        <Choice role="radio"
                          label="kg"
                          selected={a.load_unit === "kg"}
                          onPress={() => change(index, { load_unit: "kg" })}
                        />
                        <Choice role="radio"
                          label="lb"
                          selected={a.load_unit === "lb"}
                          onPress={() => change(index, { load_unit: "lb" })}
                        />
                        {(["total", "per_hand", "added", "assistance"] as const).map((value) => (
                          <Choice role="radio"
                            key={value}
                            label={value.replaceAll("_", " ")}
                            selected={a.load_convention === value}
                            onPress={() => change(index, { load_convention: value })}
                          />
                        ))}
                      </>
                    )}
                    <Field label="Actual effort · 0 to 10" optional numeric
                      {...numeric(a, index, "effort")} />
                    <Copy kind="label">How did the set feel?</Copy>
                    {(["easy", "manageable", "hard"] as const).map((value) => <Choice role="radio" key={value} label={value}
                      selected={a.difficulty === value}
                      onPress={() => change(index, { difficulty: a.difficulty === value ? null : value })} />)}
                    <Copy kind="label">Any pain during this set?</Copy>
                    {([true, false] as const).map((value) => <Choice role="radio" key={String(value)}
                      label={value ? "Yes, pain reported" : "No pain reported"} selected={a.pain_reported === value}
                      onPress={() => change(index, { pain_reported: a.pain_reported === value ? null : value })} />)}
                    <Field label="Set notes" optional multiline value={a.notes ?? ""}
                      onChange={(value) => change(index, { notes: value || null })} />
                    <Choice
                      label="This set was completed"
                      selected={a.completed}
                      onPress={() => change(index, { completed: !a.completed })}
                    />
                </>
              </Card>
            ))}
            {editing ? (
              <>
                <Field label="Session notes" multiline optional value={notes} onChange={setNotes} />
                <Notice>
                  A correction creates a new historical event. The original record and prescription remain preserved.
                </Notice>
                <Button
                  title="Save correction"
                  busy={busy}
                  disabled={!offline.ready}
                  onPress={() => {
                    void save();
                  }}
                />
                <Button title="Keep original results" secondary disabled={busy} onPress={() => setEditing(null)} />
              </>
            ) : (
              <Button
                title="Correct these results"
                variant="ghost"
                icon="create-outline"
                onPress={() => {
                  setEditing(q.data!.content.actuals.map((a) => ({ ...a })));
                  setNumericDraft({});
                  setNotes(q.data!.content.notes ?? "");
                }}
              />
            )}
          </>
        )}
      </QueryState>
      {!!error && <Notice error>{error}</Notice>}
    </Screen>
  );
}
