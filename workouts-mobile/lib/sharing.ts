import type { AuthoredWorkout } from "./models";
export type ShareKind = "workout" | "program";
export interface SharedProgram {
  title: string;
  sessions: Array<{ sequence: number; day_offset: number; workout: AuthoredWorkout }>;
  notice: string;
}
export interface ShareSnapshot {
  kind: ShareKind;
  content: AuthoredWorkout | SharedProgram;
  attribution: { shared_by_display_name: string | null; source_revision: number; original_source_included: boolean };
  review_required: boolean;
}
export interface SharePreview extends ShareSnapshot {
  id: string;
  generation: number;
  preview_digest: string;
  expires_at: string;
  link_expires_at: string;
}
export interface OwnerShare extends ShareSnapshot {
  id: string;
  generation: number;
  expires_at: string;
  revoked_at: string | null;
  snapshot_digest: string;
  api_path: string;
  app_path: string;
  website_path: string;
}
export function sharingURL(share: Pick<OwnerShare, "app_path">, website?: string) {
  const match = /^hafaworkouts:\/\/shared\/([A-Za-z0-9_-]{43})$/.exec(share.app_path);
  if (!match) throw Error("This sharing link is invalid. Reload your saved links.");
  if (website) {
    try {
      const base = new URL(website);
      if (base.protocol === "https:" && !base.username && !base.password && base.pathname === "/" && !base.search && !base.hash)
        return `${base.origin}/shared#${match[1]}`;
    } catch { /* An unavailable website configuration retains the native link. */ }
  }
  return share.app_path;
}
export interface PublicShare extends ShareSnapshot {
  id: string;
  expires_at: string;
  snapshot_digest: string;
}
let pendingToken: string | null = null;
export function rememberShare(token: string) {
  pendingToken = token;
}
export function pendingShare() {
  return pendingToken;
}
export function clearPendingShare() {
  pendingToken = null;
}
export function isISODate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function publicShareReader(base: string, transport: typeof fetch = fetch) {
  return async (token: string): Promise<PublicShare> => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw Error("This sharing link is invalid.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await transport(`${base.replace(/\/$/, "")}/api/v1/workouts/shared/${token}`, {
        signal: controller.signal,
      });
      if (!r.ok)
        throw Error(
          r.status === 404 || r.status === 410
            ? "This link is unavailable, expired or revoked."
            : "Could not load this shared snapshot. Try again."
        );
      return (await r.json()) as PublicShare;
    } finally {
      clearTimeout(timer);
    }
  };
}
