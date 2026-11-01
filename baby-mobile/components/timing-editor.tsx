import { useState } from "react";
import { View, useWindowDimensions } from "react-native";
import type { Relevance } from "@/lib/models";
import { relevanceFromForm, timingForm, timingLabel, type TimingForm } from "@/lib/timing";
import { Button, Card, Chips, Copy, Field, Notice, Row } from "./ui";

/** When a saved tip is useful: the stated timing, its quote, and a plain editor. */
export function TimingRow({ relevance, onPress }: { relevance?: Relevance | null; onPress: () => void }) {
  const label = timingLabel(relevance);
  return <Row title={label || "Add when this is useful"} icon="calendar-outline" numericTitle={!!label}
    detail={relevance?.quote ? `“${relevance.quote}”` : relevance?.origin === "user" ? "Set by you" : label ? undefined : "A pregnancy week or baby age"}
    hint="Edit when this tip shows up on Today" onPress={onPress} />;
}

export function TimingEditor({ relevance, onSave, onClose }: { relevance?: Relevance | null; onSave: (value: Relevance | null) => void; onClose: () => void }) {
  const { fontScale } = useWindowDimensions(), [initial] = useState(() => timingForm(relevance)),
    [form, setForm] = useState<TimingForm>(initial), [error, setError] = useState("");
  const change = (patch: Partial<TimingForm>) => { setError(""); setForm((value) => ({ ...value, ...patch })); };
  const noun = form.stage === "pregnancy" ? "week" : form.unit === "months" ? "month" : "week";
  function save() {
    if (JSON.stringify(form) === JSON.stringify(initial)) return onClose();
    const result = relevanceFromForm(form, relevance);
    if ("error" in result) return setError(result.error);
    onSave(result.relevance);
  }
  return <Card style={{ gap: 16 }}>
    <Copy kind="label">When is this useful?</Copy>
    <Chips label="When is this useful" value={form.stage} onChange={(stage) => change({ stage: stage as TimingForm["stage"], from: "", to: "" })}
      options={[{ label: "Pregnancy", value: "pregnancy" }, { label: "After birth", value: "baby" }, { label: "Any time", value: "none" }]} />
    {form.stage === "baby" && <Chips label="Count baby age in" value={form.unit} onChange={(unit) => change({ unit: unit as TimingForm["unit"] })}
      options={[{ label: "Months", value: "months" }, { label: "Weeks", value: "weeks" }]} />}
    {form.stage !== "none" && <View style={{ flexDirection: fontScale >= 1.3 ? "column" : "row", gap: 12 }}>
      <View style={{ flex: fontScale >= 1.3 ? undefined : 1 }}>
        <Field numeric label={`From ${noun}`} value={form.from} onChange={(from) => change({ from })} placeholder="Any" maxLength={3} />
      </View>
      <View style={{ flex: fontScale >= 1.3 ? undefined : 1 }}>
        <Field numeric label={`To ${noun}`} value={form.to} onChange={(to) => change({ to })} placeholder="Any" maxLength={3} />
      </View>
    </View>}
    <Copy kind="small" tone="muted">{form.stage === "none" ? "It stays in Saved and won’t show up on Today by week or age."
      : "Leave a box empty if the tip doesn’t say. It shows on Today when you reach it."}</Copy>
    {!!error && <Notice error>{error}</Notice>}
    <Button title="Save timing" onPress={save} />
    <Button variant="ghost" title="Cancel" onPress={onClose} />
  </Card>;
}
