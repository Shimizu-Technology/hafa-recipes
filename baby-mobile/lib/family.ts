import type { BabyRecord, Kind } from "./models";
import { careKinds } from "./models";
import { herLog } from "./spaces";
import { trackedKinds } from "./trackers";

export const disclosureVersion = 1 as const;
export interface FamilyPhone {
  id: string;
  state: "ready" | "outdated" | "unknown";
  last_seen: string | null;
  this_phone: boolean;
}
export interface FamilyReadiness { ready: boolean; phones: FamilyPhone[]; older_client_at?: string | null }
export interface FamilyInvite { id: string; code?: string; role: "parent" | "caregiver"; expires_at: string; used_at?: string | null; revoked_at?: string | null; space_id?: string; generation?: number }
export interface InvitePreview { role: "parent" | "caregiver"; expires_at: string; disclosure: string; disclosure_version: number }
export interface FamilyMember { app_user_id: string; role: "parent" | "caregiver"; status: "active" | "left" | "removed"; access_version: number; display_name: string }

/** The code in whatever they pasted, usually the whole message it came in. */
const codeShape = /hfbi_v1\.[A-Za-z0-9_-]{16,}/;
export const looksLikeCode = (text: string) => codeShape.test(text);
export const codeFrom = (text: string) => text.match(codeShape)?.[0] ?? text.trim();
export const inviteMessage = (code: string) =>
  `Join our family in Håfa Baby. Update the app first, then open your profile, Family, I have a code, and paste this. It works once, for 7 days.\n\n${code}`;

/** What the API can move between spaces. */
export const canBeJustMe = (kind: Kind) => kind === "source" || kind === "collection" || kind === "journal";

const counted = (rows: number, one: string, many = one + "s") => (rows ? [`${rows} ${rows === 1 ? one : many}`] : []);
const careLogs = new Set<Kind>([...careKinds, ...trackedKinds]);
/** What goes when a family is created, in her words. It's the only automatic publish there is, so it says all of it. */
export function whatBecomesShared(rows: readonly BabyRecord[], babies: readonly string[]) {
  const going = rows.filter((row) => row.kind !== "journal" && !row.data.just_me && !herLog(row)),
    of = (...kinds: Kind[]) => going.filter((row) => kinds.includes(row.kind)).length;
  return [
    ...babies.map((name) => `${name}’s profile`),
    ...counted(going.filter((row) => careLogs.has(row.kind)).length, "care log"),
    ...counted(of("event"), "calendar event"),
    ...counted(of("source"), "saved post"),
    ...counted(of("collection"), "category", "categories"),
    ...counted(of("question"), "doctor question"),
    ...counted(of("routine"), "list"),
  ];
}
/**
 * The code from a family just created. It's shown once and the API can't give it back, and a new family remounts every
 * screen, so it waits here, in memory, until she's done with it. Only for this account and this family, and asking as
 * anyone else forgets it. Nothing writes it down.
 */
let shown: { invite: FamilyInvite; owner: string } | null = null;
export function heldInvite(owner: string, family: string) {
  if (shown && (shown.owner !== owner || shown.invite.space_id !== family)) shown = null;
  return shown?.invite ?? null;
}
export const holdInvite = (invite: FamilyInvite, owner: string) => { shown = { invite, owner }; };
export const forgetInvite = () => { shown = null; };
