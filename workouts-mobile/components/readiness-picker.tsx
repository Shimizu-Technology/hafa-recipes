import { Copy, Segmented } from "./ui";

export type Readiness = "ready" | "limited" | "unknown";
const options: { value: Readiness; label: string }[] = [
  { value: "ready", label: "Ready" },
  { value: "limited", label: "Take it easy" },
  { value: "unknown", label: "Not sure" },
];

/** Today's check-in before a plan is proposed. It shapes only this proposal, never the saved profile. */
export function ReadinessPicker({ value, onChange }: { value: Readiness; onChange(value: Readiness): void }) {
  return (
    <>
      <Copy kind="label">How do you feel today?</Copy>
      <Segmented label="How do you feel today?" value={value} options={options} onChange={onChange} />
      <Copy kind="small" tone="muted">Only used for this plan. Your profile stays the same.</Copy>
    </>
  );
}
