/** The parts of a saved entry's data she can read, so a conflict review shows what she's about to replace. */
const hidden = new Set(["attachment_ids", "provenance", "request_id", "signature", "thumbnail_url", "mime_type", "generation", "evidence", "record_ids", "event_id", "just_me", "log_form", "timing_source"]);
const longest = 200;
const label = (key: string) => (key[0].toUpperCase() + key.slice(1)).replace(/_/g, " ");
function shown(value: unknown) {
  if (typeof value === "string") return value.length > longest ? value.slice(0, longest) + "…" : value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.every((one) => typeof one === "string" || typeof one === "number") ? value.join(", ") : String(value.length);
  return "";
}
export function savedDetails(data: Record<string, unknown> | undefined) {
  return Object.entries(data ?? {}).filter(([key]) => !hidden.has(key)).map(([key, value]) => ({ key, text: shown(value) })).filter(({ text }) => !!text)
    .map(({ key, text }) => `${label(key)}: ${text}`);
}
