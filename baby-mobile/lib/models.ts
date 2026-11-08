export type Kind = "source" | "journal" | "feeding" | "sleep" | "diaper" | "routine" | "question" | "collection" | "contraction" | "kick_session" | "pumping" | "medicine" | "temperature" | "growth" | "milestone" | "custom" | "event";
export type Scope = "all" | "library" | "journal" | "care";
export interface Profile {
  display_name: string;
  timezone: string;
  ai_consent: boolean;
  auto_process_shares?: boolean;
  auto_process_epoch?: number;
  /** Which AI disclosure this person acknowledged; the server only raises it on acknowledgment. */
  ai_consent_version?: number;
}
/** A name and a number as she typed them. Either may be missing. */
export interface CareContact {
  name?: string | null;
  phone?: string | null;
}
/** Her own, and never anyone else's to read. The baby's doctor is in `ChildDetails`, so it goes with the baby. */
export interface CareContacts {
  doctor?: CareContact | null;
  delivery?: CareContact | null;
}
/** Optional setup answers. Any of them may be missing, and an older API sends none. */
export interface ChildDetails {
  doctor?: CareContact | null;
  sex?: "girl" | "boy" | null;
  weight_at_birth_g?: number | null;
  length_at_birth_cm?: number | null;
  weeks_at_birth?: number | null;
  feeding?: "nursing" | "bottle" | "both" | null;
  tracking?: Record<string, boolean> | null;
}
/**
 * The setup screen's values. `grams` and `cm` are the exact value once there is one, kept through any change of unit;
 * they're null while the text is what she's typing.
 */
export interface ChildForm {
  stage: "expecting" | "here" | null;
  name: string;
  birth: string;
  due: string;
  weeks: string;
  days: string;
  sex: "" | "girl" | "boy";
  unit: "imperial" | "metric";
  grams: number | null;
  lb: string;
  oz: string;
  kg: string;
  cm: number | null;
  length: string;
  weeksAtBirth: string;
  feeding: "" | "nursing" | "bottle" | "both";
  doctorName: string;
  doctorPhone: string;
}
export type ChildField = "stage" | "name" | "birth" | "due" | "sex" | "weight" | "length" | "weeksAtBirth" | "feeding" | "doctorName" | "doctorPhone";
/** What she's done on the setup screen: only `touched` fields of `form` count, and they stay hers until a save succeeds. */
export interface ChildEdits {
  form: ChildForm;
  touched: ChildField[];
  /** A create was tried, and its answer may be lost. What she touched since is all it's still missing. */
  attempted: boolean;
  since: ChildField[];
}
/** Unfinished setup, kept with this account's private data until it's saved or discarded. */
export interface ChildDraft extends ChildEdits {
  creation_id: string;
  generation: number;
}
export interface Child {
  id: string;
  name: string;
  birth_date?: string | null;
  due_date?: string | null;
  details?: ChildDetails | null;
  revision: number;
  /** Where it lives, once the API lists spaces. Until then everything is personal. */
  space_id?: string;
  generation?: number;
}
/** One of this account's spaces: its own personal one, and a family it's in. */
export interface BabySpace {
  id: string;
  kind: "personal" | "family";
  role: "parent" | "caregiver";
  generation: number;
  access_version: number;
}
export interface Bootstrap {
  profile: Profile;
  children: Child[];
  /** The personal space's. */
  generation: number;
  ai_available: boolean;
  /** This API preserves reviewed visit imports and their original source spans. */
  visit_import_available?: boolean;
  active?: boolean;
  /** Only with the API's family stack on. */
  personal_space_id?: string;
  spaces?: BabySpace[];
  /** False only while the rehearsal's test list leaves this account out. */
  family_available?: boolean;
  /** Names of everyone who has been in this account's families. */
  people?: Record<string, string>;
  /** Only with the API's push flag on. Until it says so this phone asks for nothing and offers nothing. */
  reminders?: { push?: boolean; routines?: boolean };
  /** Set only while the new Ask is on: the disclosure version to show and acknowledge. */
  ask_consent_version?: number | null;
  /** Always there from an API that keeps these. An older one doesn't send it, and the app hides them. */
  contacts?: CareContacts;
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
export type TimingStage = "pregnancy" | "postpartum" | "baby";
/** When a saved tip applies, only as the source (or the parent) stated it. */
export interface Relevance {
  stage?: TimingStage | null;
  pregnancy_week_min?: number | null;
  pregnancy_week_max?: number | null;
  baby_age_min_weeks?: number | null;
  baby_age_max_weeks?: number | null;
  baby_age_unit?: "weeks" | "months" | null;
  quote?: string | null;
  origin?: "source" | "user";
}
/** An AI-proposed category; nothing is filed until the parent accepts it. */
export interface SuggestedCategory {
  name: string;
  collection_id?: string | null;
  confidence?: number;
  status: "pending" | "accepted" | "dismissed";
}
export interface FeedAction {
  id: string;
  action: "start" | "switch" | "finish";
  at: string;
  side?: "left" | "right";
  /** The revision this tap made, set by the API. A retry can't be told from the row alone, so this is the proof. */
  revision?: number;
}
/** A kick session's tap or take-back, or a contraction's stop. */
export interface SessionAction {
  id: string;
  action: "tap" | "undo" | "finish";
  at: string;
  /** What an undo takes back. */
  target?: string;
  /** As on a feed action. */
  revision?: number;
}
export type EventCategory = "appointment" | "family" | "celebration" | "milestone" | "reminder" | "other";
export interface EventRecurrence {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  /** The last day an occurrence can start, on the event's own calendar. */
  until?: string | null;
  /** Where the count starts when that's earlier than the event, as for a series split off another: Jan 31 keeps its month ends from a Feb 28 start. */
  anchor?: string | null;
}
/** What one occurrence changes. A field left out keeps the series' value, and null clears it. */
export interface EventOverrides {
  start?: string;
  end?: string | null;
  all_day?: boolean;
  title?: string;
  category?: EventCategory | null;
  category_label?: string | null;
  location?: string | null;
  attendees?: string[];
}
export interface EventException {
  original_start: string;
  cancelled?: boolean;
  overrides?: EventOverrides | null;
}
/** One dated showing of an event, as `GET /events` returns it. It's identified by its event and its original start. */
export interface EventOccurrence {
  event_id: string;
  original_start: string;
  occurrence_start: string;
  occurrence_end: string | null;
  all_day: boolean;
  timezone: string;
  title: string;
  category: EventCategory | null;
  /** Her own name for it. The API sends it from this release on, so an older answer has none. */
  category_label?: string | null;
  location: string | null;
  attendees: string[];
  child_id: string | null;
  repeats: boolean;
  changed: boolean;
  revision: number;
}
export interface RecordData {
  medical_visit?: boolean;
  provider_default_at?: number | null;
  provider_default?: boolean;
  paste_origin?: { text: string; start: number; end: number; original: boolean } | null;
  clinician_age?: string | null;
  doctor?: string | null;
  due_date_snapshot?: string | null;
  results?: string | null;
  result_status?: "unknown" | "pending" | "received" | null;
  follow_up?: string | null;
  /** Which of CDC's milestones this records. The title keeps the words she checked, even if CDC later rewords them. */
  milestone_id?: string;
  /** What a custom entry is, such as "Shot". */
  label?: string;
  provenance?: "caregiver_observation" | "clinician_instruction";
  url?: string;
  topics?: string[];
  source_text?: string;
  user_text?: string;
  legacy_saved_text?: string;
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
  /** A running feed's actions; everything else about it is derived from them, here and on the server. */
  actions?: FeedAction[];
  state?: "running" | "finished" | "unknown_end";
  /** What's in a bottle. Stored in the API's words; shown as Breast milk or Formula. */
  contents?: "breast_milk" | "formula" | null;
  end_at?: string | null;
  /** Movements felt in a kick session, from its actions. */
  count?: number;
  session_actions?: SessionAction[];
  type?: "wet" | "dirty" | "both" | "dry";
  /** A poo's colour, as the API stores it. */
  color?: "black" | "green" | "yellow" | "brown" | "red" | "white" | null;
  routine_type?: "checklist" | "schedule";
  items?: RoutineItem[];
  reminder_at?: string;
  timezone?: string;
  repeat?: "none" | "daily" | "weekly";
  enabled?: boolean;
  attachment_ids?: string[];
  record_ids?: string[];
  relevance?: Relevance | null;
  suggested_category?: SuggestedCategory | null;
  /** An event's start is its `occurred_at`, and no child means the whole family. `timezone` is its own calendar. */
  end?: string | null;
  all_day?: boolean;
  category?: EventCategory | null;
  /** Her own name for the kind of event. Only a category of "other", or none, shows it. */
  category_label?: string | null;
  location?: string | null;
  attendees?: string[];
  /** Minutes before the start; for an all-day event, before 9 AM on its first day. */
  reminder_minutes?: number[];
  recurrence?: EventRecurrence | null;
  exceptions?: EventException[];
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
  /** Where it lives, once the API lists spaces. Until then everything is personal. */
  space_id?: string;
  generation?: number;
  /** Who logged it, with spaces listed. Null once that account is gone, and missing while it's still queued here. */
  created_by?: string | null;
}
export type RecordWrite = Pick<BabyRecord, "id" | "kind" | "title" | "body" | "child_id" | "occurred_at" | "data"> & {
  revision?: number;
};
export interface RecordPage {
  items: BabyRecord[];
  total: number;
  has_more: boolean;
  timing?: { mode: "now" | "upcoming"; stage: "pregnancy" | "baby"; pregnancy_week?: number; pregnancy_day?: number;
    baby_age_weeks?: number; child_id?: string; basis: "child" | "query"; today?: string };
}
export type SuggestionStatus = "accepted" | "dismissed" | "conflict" | "no_suggestion" | "unavailable" | "category_full";
export interface SuggestionResult {
  results: { record_id: string; status: SuggestionStatus; collection_id?: string | null }[];
  records: BabyRecord[];
  collections: BabyRecord[];
}
export interface ImportJob {
  id: string;
  status: string;
  record_id?: string | null;
  error?: string | null;
  /** Private device snapshot taken durably before admission, never sent to the API. */
  baseline?: BabyRecord | null;
  automatic?: boolean;
  reconciled?: boolean;
  space_id?: string;
  generation?: number;
}
export interface Citation {
  id: string;
  title: string;
  excerpt: string;
  /** Present on newer responses; older stored conversations omit it. */
  kind?: Kind;
}
/** A link from the trusted list a new-Ask answer used. */
export interface WebSource {
  url: string;
  title: string;
  domain: string;
  ref?: string;
}
export type AskHelp = "urgent_maternal" | "harm" | "baby_unwell" | "mental_health" | "cant_answer";
export interface Proposal {
  kind: Kind;
  title: string;
  body: string;
  data: RecordData;
  /** A suggested event's start. Other kinds are dated when she saves them. */
  occurred_at?: string;
}
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  proposal?: Proposal;
  sources?: WebSource[];
  help?: AskHelp | null;
  id?: string;
}
export interface Conversation {
  id: string;
  scope: Scope;
  record_id: string | null;
  child_id: string | null;
  title?: string;
  updated_at?: string;
  /** Set when this chat was opened about one day. */
  focus_date?: string | null;
  messages?: ChatMessage[];
}
export interface ChatResult {
  /** Null only when an urgent reply couldn't be kept in the chat: she still gets the reply. */
  conversation_id: string | null;
  message: string;
  citations: Citation[];
  proposal?: Proposal;
  sources?: WebSource[];
  help?: AskHelp | null;
}
/**
 * What a save or draft was built on: the queued changes to this record it already showed, oldest first. Only these can
 * move it to a newer revision. Copies kept by an earlier test build hold more here, which nothing reads.
 */
export interface SaveBase { after: string[] }
/** What became of a queued change: the revision it's proven to have made, or that it was discarded. Neither means not known. */
export interface SettledChange { made?: number; discarded?: boolean; made_for?: Record<string, number> }
/** How an open editor is changing a repeating event. `series` is the event as it was when she chose. */
export interface EventEdit {
  scope: "one" | "future";
  original_start: string;
  series: Pick<BabyRecord, "title" | "body" | "child_id" | "occurred_at" | "data">;
}
export type LogFormDraft = import("./more-logs").LogForm;
export const deviceVersion = 4;
/** Unfinished editor work is recovery content, never an outbox mutation. */
export interface HeldDraft {
  id: string;
  slot?: string;
  /** Only late autosaves replace this row; departure snapshots stay separate. */
  editor?: boolean;
  /** Old Retry erased whether Save was pressed. Requires an explicit send decision. */
  uncertain?: boolean;
  draft: EditorDraft;
  /** Legacy actions whose uncertain ancestor must be reviewed first. Never automatically replayed. */
  followups?: Mutation[];
}
export interface EditorDraft {
  id: string;
  /** An existing entry's space, copied with it into the draft. */
  space_id?: string;
  generation?: number;
  /** Shared with family or Just me, as she chose on a new entry. */
  shared?: boolean;
  kind: Kind;
  title: string;
  body: string;
  child_id: string | null;
  occurred_at: string;
  data: RecordData;
  revision?: number;
  files: LocalFile[];
  existing?: boolean;
  base?: SaveBase;
  /** What she's typed into a log's fields, kept even while it can't be saved. Never sent to the API. */
  log_form?: LogFormDraft;
  event_edit?: EventEdit;
}
export type Mutation = {
  /** Recovery content from an editor, without Save intent. Never eligible for delivery. */
  draft_only?: boolean;
  localOnly?: boolean;
  /** The space it's for, and `generation` is that space's. None with the API's family flag off, or from an older build. */
  space_id?: string;
  /** The family it was for, once this account is out of it. It's kept to copy or discard, and never sent. */
  left_space?: string;
  /** How many times the API has said its row moved. */
  retargets?: number;
} & (
  | {
      id: string;
      generation: number;
      type: "save";
      record: RecordWrite;
      files: LocalFile[];
      base?: SaveBase;
      /** Waiting to try again after the service said not yet. */
      hold_until?: string;
      attempts?: number;
      error?: string;
      conflict?: boolean;
    }
  | { id: string; generation: number; type: "delete"; record: BabyRecord; hold_until?: string; attempts?: number; error?: string; conflict?: boolean }
  | {
      /** "All future" from a later date. One change, so the series can't end unless the next one starts. The id is the new event's, which makes a retry the same split. */
      id: string;
      generation: number;
      type: "event_split";
      /** The series as it'll be, for showing until this lands. The API works out its end again from what it holds. */
      series: RecordWrite;
      event: RecordWrite;
      from_start: string;
      files: LocalFile[];
      base?: SaveBase;
      hold_until?: string;
      attempts?: number;
      error?: string;
      conflict?: boolean;
    }
  | {
      /** The action's own id, which is what makes a retry idempotent. */
      id: string;
      generation: number;
      type: "feed_action";
      record_id: string;
      action: FeedAction;
      /** Stays on this phone until then: for Undo, or between retries. */
      hold_until?: string;
      /** Its request has begun, so the API may already have it. Undo can't take it back any more. */
      sent?: boolean;
      attempts?: number;
      error?: string;
      conflict?: boolean;
    }
  | {
      /** The action's own id, as on a feed action. */
      id: string;
      generation: number;
      type: "session_action";
      record_id: string;
      action: SessionAction;
      hold_until?: string;
      sent?: boolean;
      attempts?: number;
      error?: string;
      conflict?: boolean;
    }
  | {
      /** "Baby's here" with no signal: only the birth date changes, and only from the value it saw. */
      id: string;
      generation: number;
      type: "child_birth";
      child_id: string;
      birth_date: string | null;
      previous: string | null;
      hold_until?: string;
      sent?: boolean;
      attempts?: number;
      error?: string;
      conflict?: boolean;
    }
  | {
      /** A person's reminder settings. Only what's named changes. */
      id: string;
      generation: number;
      type: "reminder_prefs";
      patch: PrefsPatch;
      hold_until?: string;
      sent?: boolean;
      attempts?: number;
      error?: string;
      conflict?: boolean;
    }
  | {
      /** A "What shows" switch: only these keys change, and the API merges them key by key. */
      id: string;
      generation: number;
      type: "child_tracking";
      child_id: string;
      tracking: Record<string, boolean>;
      /** What each key was, for when it's discarded. Null means it was following its default. */
      previous: Record<string, boolean | null>;
      hold_until?: string;
      sent?: boolean;
      attempts?: number;
      error?: string;
      conflict?: boolean;
    }
  | {
      id: string;
      generation: number;
      type: "import";
      baseline?: BabyRecord | null;
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
/** A breastfeed being timed by an older build, on one device. It finishes the old way, then is gone. Active time is the sum of segments; a pause
 * closes the open segment. It belongs to one Baby space generation and is never synced. */
export interface FeedTimer {
  child_id: string;
  generation: number;
  started_at: string;
  segments: { side: "left" | "right"; started_at: string; ended_at?: string }[];
  paused_at?: string;
  /** The record this timer's feed was already saved as. Without one, it saves its own entry. */
  record_id?: string;
}
export type ReminderKind = "event" | "visit_prep" | "import" | "feed_interval" | "running_timer" | "pregnancy_week" | "milestone_window" | "well_visit";
export interface KindPref {
  enabled: boolean;
  /** Comes through quiet hours, as time-sensitive. */
  break_through: boolean;
  hours: number | null;
  feed_hours: number | null;
  sleep_hours: number | null;
}
export interface QuietHours {
  start: string;
  end: string;
  timezone: string;
}
export interface ReminderPrefs {
  quiet_hours: QuietHours | null;
  kinds: Partial<Record<ReminderKind, KindPref>>;
}
export interface PrefsPatch {
  quiet_hours?: QuietHours | null;
  kinds?: Partial<Record<ReminderKind, Partial<KindPref>>>;
}
/** One row of `/reminders/due`. Its words are for this person's own Today, never a lock screen. */
export interface DueReminder {
  id: string;
  kind: string;
  space_id?: string;
  text: string;
  due_at: string;
  delivery: string;
  identity: string;
  data: Record<string, unknown>;
}
/** One row of `/reminders/upcoming`: what a phone can hold as its offline copy. */
export interface UpcomingReminder {
  id: string;
  kind: string;
  space_id?: string;
  identity: string;
  fire_at: string;
  text: string;
  time_sensitive: boolean;
  data: Record<string, unknown>;
}
export interface DeviceState {
  visitDefaults?: Record<string, { doctor: string | null; location: string | null } | null>;
  feedTimer?: FeedTimer;
  /** What the API said is waiting, for the offline copy. */
  upcomingReminders?: UpcomingReminder[];
  /** What the API last said is due, for Today with no signal. */
  dueReminders?: DueReminder[];
  /** Dismissed here and not heard yet. */
  dismissing?: string[];
  /** The API's copy of this person's settings. Only with its push flag on. */
  reminderPrefs?: ReminderPrefs;
  /** Taps the API couldn't apply, kept until she has seen why. */
  feedNotices?: string[];
  /** Ask has shown its reminder about sources on this device. */
  askNoticeSeen?: boolean;
  routine_sync?: { owner: string; generation: number; complete: boolean; managed_ids: string[] };
  fileUploads: Record<string, string>;
  fileReleases?: string[];
  bootstrap?: Bootstrap;
  records: BabyRecord[];
  outbox: Mutation[];
  /** Recent changes that have left the outbox, for an editor opened before they did. */
  settled?: Record<string, SettledChange>;
  drafts: Record<string, EditorDraft>;
  heldDrafts?: HeldDraft[];
  /** By child id, or `new` for a profile not saved yet. Not in `drafts`: those are all records. */
  childDrafts?: Record<string, ChildDraft>;
  imports: ImportJob[];
  selectedChild: string | null;
  /** Her own babies she's chosen to keep alongside a family's, so she's only asked once. */
  personalBabiesKept?: string[];
  /** What the API said was removed, newest last. It's the only proof a row is gone: not being here proves nothing. */
  removed?: string[];
  /** Which storage shape this was saved in. None means a build before spaces. */
  version?: number;
  /** How far `/changes` has come in each space, and the access versions that came with it. */
  changes?: { cursor: Record<string, number>; access: Record<string, number> };
}
export const emptyState = (): DeviceState => ({
  version: deviceVersion,
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
  contraction: "Contraction",
  kick_session: "Kick count",
  pumping: "Pumping",
  medicine: "Medicine",
  temperature: "Temperature",
  growth: "Growth",
  milestone: "Milestone",
  custom: "Entry",
  event: "Event",
};
/** A kind's name, for words built around it. A kind from a newer build has none yet, and must not crash the screen. */
export const kindWord = (kind: Kind) => kindName[kind] ?? "Entry";
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
