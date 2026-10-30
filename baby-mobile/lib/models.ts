export type Kind = "source" | "journal" | "feeding" | "sleep" | "diaper" | "routine" | "question" | "collection";
export type Scope = "all" | "library" | "journal" | "care";
export interface Profile {
  display_name: string;
  timezone: string;
  ai_consent: boolean;
  auto_process_shares?: boolean;
  auto_process_epoch?: number;
}
export interface Child {
  id: string;
  name: string;
  birth_date?: string | null;
  due_date?: string | null;
  revision: number;
}
export interface Bootstrap {
  profile: Profile;
  children: Child[];
  generation: number;
  ai_available: boolean;
  active?: boolean;
}
export interface Attachment {
  id: string;
  name: string;
  mime_type: string;
  size: number;
}
export interface LocalFile {
  id: string;
  uri: string;
  name: string;
  mime_type: string;
  size?: number;
  uploaded_id?: string;
}
export interface Evidence {
  location?: string;
  text?: string;
  excerpt?: string;
  source?: string;
  timestamp?: string;
  [key: string]: unknown;
}
export interface RoutineItem {
  id: string;
  label: string;
  done: boolean;
}
export interface RecordData {
  provenance?: "caregiver_observation" | "clinician_instruction";
  url?: string;
  topics?: string[];
  source_text?: string;
  summary?: string;
  key_points?: string[];
  steps?: string[];
  creator?: string | null;
  platform?: string | null;
  thumbnail_url?: string | null;
  coverage_notes?: string[];
  evidence?: Evidence[];
  status?: string;
  method?: "breast" | "bottle" | "other";
  amount?: number | null;
  unit?: "ml" | "oz";
  side?: "left" | "right" | "both";
  duration_minutes?: number | null;
  end_at?: string;
  type?: "wet" | "dirty" | "both" | "dry";
  routine_type?: "checklist" | "schedule";
  items?: RoutineItem[];
  reminder_at?: string;
  timezone?: string;
  repeat?: "none" | "daily" | "weekly";
  enabled?: boolean;
  attachment_ids?: string[];
  record_ids?: string[];
  [key: string]: unknown;
}
export interface BabyRecord {
  cache_partial?: boolean;
  id: string;
  kind: Kind;
  title: string;
  body: string;
  child_id: string | null;
  occurred_at: string;
  data: RecordData;
  revision: number;
  created_at: string;
  updated_at: string;
}
export type RecordWrite = Pick<BabyRecord, "id" | "kind" | "title" | "body" | "child_id" | "occurred_at" | "data"> & {
  revision?: number;
};
export interface RecordPage {
  items: BabyRecord[];
  total: number;
  has_more: boolean;
}
export interface ImportJob {
  id: string;
  status: string;
  record_id?: string | null;
  error?: string | null;
}
export interface Citation {
  id: string;
  title: string;
  excerpt: string;
  /** Present on newer responses; older stored conversations omit it. */
  kind?: Kind;
}
export interface Proposal {
  kind: Kind;
  title: string;
  body: string;
  data: RecordData;
}
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  proposal?: Proposal;
  id?: string;
}
export interface Conversation {
  id: string;
  scope: Scope;
  record_id: string | null;
  child_id: string | null;
  title?: string;
  updated_at?: string;
  messages?: ChatMessage[];
}
export interface ChatResult {
  conversation_id: string;
  message: string;
  citations: Citation[];
  proposal?: Proposal;
}
export interface EditorDraft {
  id: string;
  kind: Kind;
  title: string;
  body: string;
  child_id: string | null;
  occurred_at: string;
  data: RecordData;
  revision?: number;
  files: LocalFile[];
  existing?: boolean;
}
export type Mutation = { localOnly?: boolean } & (
  | {
      id: string;
      generation: number;
      type: "save";
      record: RecordWrite;
      files: LocalFile[];
      error?: string;
      conflict?: boolean;
    }
  | { id: string; generation: number; type: "delete"; record: BabyRecord; error?: string; conflict?: boolean }
  | {
      id: string;
      generation: number;
      type: "import";
      automatic?: boolean;
      automatic_epoch?: number;
      url?: string;
      text?: string;
      record_id?: string;
      attachment_ids?: string[];
      files: LocalFile[];
      child_id?: string | null;
      topics?: string[];
      error?: string;
      conflict?: boolean;
    }
);
/** A breastfeed being timed on this device. Active time is the sum of segments; a pause
 * closes the open segment. It belongs to one Baby space generation and is never synced. */
export interface FeedTimer {
  child_id: string;
  generation: number;
  started_at: string;
  segments: { side: "left" | "right"; started_at: string; ended_at?: string }[];
  paused_at?: string;
}
export interface DeviceState {
  feedTimer?: FeedTimer;
  routine_sync?: { owner: string; generation: number; complete: boolean; managed_ids: string[] };
  fileUploads: Record<string, string>;
  fileReleases?: string[];
  bootstrap?: Bootstrap;
  records: BabyRecord[];
  outbox: Mutation[];
  drafts: Record<string, EditorDraft>;
  imports: ImportJob[];
  selectedChild: string | null;
}
export const emptyState = (): DeviceState => ({
  fileUploads: {},
  records: [],
  outbox: [],
  drafts: {},
  imports: [],
  selectedChild: null,
});
export const kindName: Record<Kind, string> = {
  source: "Saved source",
  journal: "Journal entry",
  feeding: "Feeding",
  sleep: "Sleep",
  diaper: "Diaper",
  routine: "Routine",
  question: "Doctor question",
  collection: "Collection",
};
export const careKinds: Kind[] = ["feeding", "sleep", "diaper"];
export function messageFor(error: unknown) {
  return error instanceof Error ? error.message : "Something interrupted this step. Your draft is safe. Try again.";
}
export function optimisticRecord(write: RecordWrite): BabyRecord {
  const now = new Date().toISOString();
  return { ...write, revision: write.revision ?? 0, created_at: now, updated_at: now };
}

function sourceDisplayText(value: unknown, maximum: number) {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return text.length > maximum ? text.slice(0, maximum - 1) + "…" : text;
}
/** Match the API's 30 notes / 300 characters without exposing malformed object fields. */
export function sourceProcessingNotes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const notes = [
    ...new Set(
      value
        .slice(0, 30)
        .map((note) => sourceDisplayText(note, 300))
        .filter(Boolean)
    ),
  ];
  // This exact extractor warning describes sampled frames, not complete video
  // coverage. Keep the source's timestamp spelling, including decimal precision.
  const sampled = notes.map((note) =>
    /^image:[0-7] sampled at ((?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?)s; samples do not cover every frame\.$/.exec(note)
  );
  const timestamps = sampled.flatMap((match) =>
    match && Number.isFinite(Number(match[1])) ? [match[1]] : []
  );
  if (timestamps.length < 2) return notes;
  const grouped = `${timestamps.length} video frames were sampled at ${timestamps.join(", ")} seconds. Details between frames may be missing.`;
  // Never shorten away timestamps to fit the existing display bound.
  if (grouped.length > 300) return notes;
  let inserted = false;
  return notes.flatMap((note, index) => {
    if (!sampled[index] || !Number.isFinite(Number(sampled[index]![1]))) return [note];
    if (inserted) return [];
    inserted = true;
    return [grouped];
  });
}
/** Only translate recognized acquisition locations; never display internal identifiers. */
export function sourceEvidenceLocation(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 160) return;
  const attachment = /^attachment:([0-7])(?::(.+))?$/.exec(value);
  const location = attachment ? attachment[2] : value;
  if (attachment && !location) return `Attachment ${Number(attachment[1]) + 1}`;
  const names: Record<string, string> = {
    caption: "Source caption",
    transcript: "Audio transcript",
    uploaded_transcript: "Audio transcript",
    pasted_text: "Text you added",
    provided_text: "Text you added",
    page_text: "Website text",
    document_text: "Document text",
  };
  let label = Object.hasOwn(names, location ?? "") ? names[location ?? ""] : undefined;
  const page = /^document_page:([1-9]\d{0,2})$/.exec(location ?? "");
  const image = /^image:(\d{1,2})$/.exec(location ?? "");
  const frame = /^uploaded_frame:(\d{1,4}(?:\.\d)?)s$/.exec(location ?? "");
  if (page) label = `Document page ${page[1]}`;
  if (image) label = `Source image ${Number(image[1]) + 1}`;
  if (frame && Number(frame[1]) <= 1800) label = `Sampled video frame at ${Number(frame[1])} seconds`;
  if (!label) return;
  return attachment ? `Attachment ${Number(attachment[1]) + 1} · ${label}` : label;
}
export function sourceEvidenceItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const text = sourceDisplayText(entry.text, 12000) || sourceDisplayText(entry.excerpt, 12000);
    return text
      ? [
          {
            text,
            location: sourceEvidenceLocation(entry.location),
            timestamp: sourceDisplayText(entry.timestamp, 80),
            source: sourceDisplayText(entry.source, 160),
          },
        ]
      : [];
  });
}

/** "1 pending change" / "3 pending changes". */
export function pendingChanges(count: number) {
  return `${count} pending ${count === 1 ? "change" : "changes"}`;
}
