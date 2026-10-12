import { HealthExport } from "@/components/health-export";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { Button, Card, Choice, Copy, Field, Notice, Screen } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { summaryOf, actualIdentity, historicalStructureWarning } from "@/lib/training";
import type { ActualSet } from "@/lib/models";
export default function SessionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, owner } = useTraining();
  const offline = useOfflineTraining();
  const q = useQuery({ queryKey: [owner, "session", id], queryFn: () => api.session(id) });
  const [editing, setEditing] = useState<ActualSet[] | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!q.data || !editing || !offline.store) return;
    setBusy(true);
    try {
      await offline.store.correct(q.data, editing, notes, Crypto.randomUUID());
      void offline.store.sync(api.saveSession);
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
  return (
    <Screen
      back
      title={q.data?.title ?? "Your saved session."}
      subtitle="Actual results and the prescription used at the time."
    >
      <QueryState
        loading={q.isPending}
        error={q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {q.data && (
          <>
            <Button
              title="Chat about this recorded session"
              secondary
              onPress={() => router.push({ pathname: "/coach", params: { session_id: q.data!.id } })}
            />
            {!!historicalStructureWarning(q.data.content.prescription_snapshot, q.data.content.actuals) && (
              <Notice>{historicalStructureWarning(q.data.content.prescription_snapshot, q.data.content.actuals)}</Notice>
            )}
            <HealthExport sessionId={q.data.id} />
            <Card>
              <Copy>
                {new Date(q.data.started_at).toLocaleString()} · {q.data.status}
              </Copy>
              {q.data.content.active_seconds != null && (
                <Copy>{Math.round(q.data.content.active_seconds / 60)} recorded active minutes</Copy>
              )}
              {!!q.data.content.notes && <Copy>{q.data.content.notes}</Copy>}
            </Card>
            {(editing ?? q.data.content.actuals).map((a, index) => (
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
                {editing ? (
                  <>
                    <Field
                      label="Actual reps"
                      optional
                      numeric
                      value={a.reps == null ? "" : String(a.reps)}
                      onChange={(v) => change(index, { reps: v.trim() ? Number(v) : null })}
                    />
                    <Field
                      label="Actual seconds"
                      optional
                      numeric
                      value={a.duration_seconds == null ? "" : String(a.duration_seconds)}
                      onChange={(v) => change(index, { duration_seconds: v.trim() ? Number(v) : null })}
                    />
                    <Field
                      label={`Actual load · ${a.load_unit ?? "choose unit when adding load"}`}
                      optional
                      numeric
                      value={a.load == null ? "" : String(a.load)}
                      onChange={(v) => change(index, { load: v.trim() ? Number(v) : null })}
                    />
                    {a.load != null && (
                      <>
                        <Choice
                          label="kg"
                          selected={a.load_unit === "kg"}
                          onPress={() => change(index, { load_unit: "kg" })}
                        />
                        <Choice
                          label="lb"
                          selected={a.load_unit === "lb"}
                          onPress={() => change(index, { load_unit: "lb" })}
                        />
                        {(["total", "per_hand", "added", "assistance"] as const).map((value) => (
                          <Choice
                            key={value}
                            label={value.replaceAll("_", " ")}
                            selected={a.load_convention === value}
                            onPress={() => change(index, { load_convention: value })}
                          />
                        ))}
                      </>
                    )}
                    <Choice
                      label="This set was completed"
                      selected={a.completed}
                      onPress={() => change(index, { completed: !a.completed })}
                    />
                  </>
                ) : (
                  <Copy>{a.completed ? summaryOf(a) : "Skipped"}</Copy>
                )}
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
                secondary
                onPress={() => {
                  setEditing(q.data!.content.actuals.map((a) => ({ ...a })));
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
