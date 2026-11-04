import { useState } from "react";
import { View } from "react-native";
import { methodWords } from "../lib/care-format";
import { changeWeightUnit, type LogForm } from "../lib/more-logs";
import { Chips, Field } from "@/components/ui";

export const sideWords = { left: "Left", right: "Right", both: "Both" } as const;

/** The fields for one kind of log. It holds what she has typed; the panel and the editor each decide what to do with it. */
export function LogFields({ id, start, autoFocus, onChange }: { id: string; start: LogForm; autoFocus?: boolean; onChange?: (form: LogForm) => void }) {
  const [form, setForm] = useState(start),
    set = (change: Partial<LogForm>) => { const next = { ...form, ...change }; setForm(next); onChange?.(next); },
    unit = (value: string, options: [string, string][], change: (one: string) => void, label: string) =>
    <Chips label={label} value={value} onChange={change} options={options.map(([id, word]) => ({ value: id, label: word }))} />;
  if (id === "pumping") return <>
    {unit(form.side, Object.entries(sideWords), (side) => set({ side: side as LogForm["side"] }), "Side")}
    <Field numeric label="Amount (optional)" value={form.amount} onChange={(amount) => set({ amount })} />
    {unit(form.amountUnit, [["oz", "oz"], ["ml", "mL"]], (amountUnit) => set({ amountUnit: amountUnit as LogForm["amountUnit"] }), "Amount unit")}
    <Field numeric label="Minutes (optional)" value={form.minutes} onChange={(minutes) => set({ minutes })} />
  </>;
  if (id === "medicine") return <>
    <Field label="Name" value={form.name} maxLength={120} autoFocus={autoFocus} onChange={(name) => set({ name })} />
    <Field label="Dose (optional)" value={form.dose} maxLength={80} onChange={(dose) => set({ dose })} />
  </>;
  if (id === "temperature") return <>
    <Field numeric label="Temperature" value={form.value} autoFocus={autoFocus} onChange={(value) => set({ value })} />
    {unit(form.unit, [["f", "°F"], ["c", "°C"]], (next) => set({ unit: next as LogForm["unit"] }), "Scale")}
    {unit(form.method, [["", "Not set"], ...Object.entries(methodWords)], (method) => set({ method: method as LogForm["method"] }), "How it was taken")}
  </>;
  if (id === "custom") return <Field label="What is it?" value={form.label} maxLength={80} autoFocus={autoFocus} onChange={(label) => set({ label })} />;
  if (id === "feeling") return <Field label="How you’re feeling" value={form.name} maxLength={240} autoFocus={autoFocus} onChange={(name) => set({ name })} />;
  if (id === "vitamins") return <Field label="What you took" value={form.name} maxLength={240} autoFocus={autoFocus} onChange={(name) => set({ name })} />;
  if (id === "my_weight") return <>
    <Field numeric label="Weight" value={form.myWeight} autoFocus={autoFocus} onChange={(myWeight) => set({ myWeight })} />
    {unit(form.myWeightUnit, [["lb", "lb"], ["kg", "kg"]], (next) => set({ myWeightUnit: next as LogForm["myWeightUnit"] }), "Weight unit")}
  </>;
  if (id === "blood_pressure") return <View style={{ flexDirection: "row", gap: 8 }}>
    <View style={{ flex: 1 }}><Field numeric label="Top number" value={form.top} autoFocus={autoFocus} onChange={(top) => set({ top })} /></View>
    <View style={{ flex: 1 }}><Field numeric label="Bottom number" value={form.bottom} onChange={(bottom) => set({ bottom })} /></View>
  </View>;
  return <>
    {form.weightUnit === "lb" ? <View style={{ flexDirection: "row", gap: 8 }}>
      <View style={{ flex: 1 }}><Field numeric label="Pounds" value={form.lb} onChange={(lb) => set({ lb })} /></View>
      <View style={{ flex: 1 }}><Field numeric label="Ounces" value={form.oz} onChange={(oz) => set({ oz })} /></View>
    </View> : <Field numeric label="Weight in kg" value={form.kg} onChange={(kg) => set({ kg })} />}
    {unit(form.weightUnit, [["lb", "lb & oz"], ["kg", "kg"]], (next) => set(changeWeightUnit(form, next as LogForm["weightUnit"])), "Weight unit")}
    <Field numeric label={`Length in ${form.lengthUnit}`} value={form.length} onChange={(length) => set({ length })} />
    <Field numeric label={`Head around in ${form.headUnit}`} value={form.head} onChange={(head) => set({ head })} />
    {unit(form.lengthUnit, [["in", "in"], ["cm", "cm"]], (next) => set({ lengthUnit: next as "in", headUnit: next as "in" }), "Length and head unit")}
  </>;
}
