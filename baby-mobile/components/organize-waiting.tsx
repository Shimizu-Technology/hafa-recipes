import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { ensureAiConsent } from "@/lib/ai-consent";
import { messageFor, type BabyRecord } from "../lib/models";
import { isCaregiver } from "../lib/spaces";
import { advanceOrganize, clearOrganize, findWaiting, organizeAgainAt, organizeHeld, organizeWords, startOrganize, stopOrganize, waitingSource } from "../lib/organize-waiting";
import { addDays, clockIn, recordDay } from "../lib/tracker";
import { Button, Card, Copy, Notice, useColors } from "./ui";

/**
 * Moves a run along whenever the outbox or an import changes, and after a pause. Mounted once, beside the share
 * capture, so a run carries on after a relaunch without Saved being opened.
 */
export function OrganizeRunner() {
  const b = useBaby(), run = b.state.organizeRun, running = !!run && !run.finished_at, [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const state = b.state;
    if (advanceOrganize(state, () => "probe") !== state) {
      void b.commit((s) => advanceOrganize(s, Crypto.randomUUID)).then(() => b.sync()).catch(() => undefined);
      return;
    }
    if (run?.paused_until) {
      const wait = Math.max(1000, new Date(run.paused_until).getTime() - Date.now() + 500);
      const timer = setTimeout(() => setTick((n) => n + 1), wait);
      return () => clearTimeout(timer);
    }
  }, [running, b.state.outbox, b.state.imports, run, tick]);
  return null;
}

/** "1:35 PM tomorrow", on the family's clock. */
function againWords(iso: string | undefined, timeZone: string | undefined, now = new Date()) {
  if (!iso) return undefined;
  const day = recordDay(iso, timeZone), today = recordDay(now.toISOString(), timeZone), clock = clockIn(new Date(iso), timeZone);
  return day === today ? `${clock} today` : day === addDays(today, 1) ? `${clock} tomorrow` : undefined;
}
const retries = [3_000, 10_000, 30_000];

/**
 * Saved posts that were never organized, and one tap to organize them all. While it runs, the card is the progress;
 * when it's done, the card says what happened until she dismisses it. `scan` changes when Saved is pulled to refresh.
 */
export function OrganizeWaiting({ scan = 0 }: { scan?: number }) {
  const b = useBaby(), c = useColors(), run = b.state.organizeRun, bootstrap = b.state.bootstrap;
  const [found, setFound] = useState<BabyRecord[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0), [, setClock] = useState(0), starting = useRef(false);
  const allowed = !!bootstrap?.ai_available && !isCaregiver(bootstrap), running = !!run && !run.finished_at;
  const latest = useRef(b);
  latest.current = b;
  // The posts on this phone that look waiting. When one arrives (a share that just synced, say), look again: the
  // first look can come before the API has it, and without this the card stayed away until a pull to refresh.
  const local = (b.records ?? []).filter((row) => waitingSource(row, b.state)).map((row) => row.id).join(",");
  useEffect(() => {
    if (!allowed || running) return;
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    findWaiting((offset) => latest.current.api.records({ kind: "source", limit: 100, offset }), latest.current.state)
      .then((rows) => { if (alive && latest.current.current()) setFound(rows); })
      // Nothing to offer is the safe answer, since the posts are all still in Saved. A look that failed (opening, no
      // signal) tries again a few times rather than waiting for a pull to refresh.
      .catch(() => {
        if (!alive) return;
        setFound([]);
        if (attempt < retries.length) timer = setTimeout(() => setAttempt((n) => n + 1), retries[attempt]);
      });
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [allowed, running, scan, bootstrap?.generation, local, attempt]);
  const held = organizeHeld(b.state);
  // Offer it again when the limit could have passed, without waiting for something else to change.
  useEffect(() => {
    if (!held) return;
    const timer = setTimeout(() => setClock((n) => n + 1), Math.min(24 * 3600_000, new Date(b.state.organizeHeldUntil!).getTime() - Date.now() + 1000));
    return () => clearTimeout(timer);
  }, [held, b.state.organizeHeldUntil]);
  if (!allowed || (!run && !found.length)) return null;
  async function start() {
    if (starting.current) return;
    starting.current = true; setBusy(true); setError("");
    try {
      if (!await ensureAiConsent(b)) return;
      await b.commit((s) => advanceOrganize(startOrganize(s, found), Crypto.randomUUID));
      setFound([]);
      void b.sync();
    } catch (failure) { setError(messageFor(failure)); }
    finally { starting.current = false; setBusy(false); }
  }
  const timeZone = bootstrap?.profile?.timezone,
    words = organizeWords(run, found.length, { held, again: againWords(run ? organizeAgainAt(run) : b.state.organizeHeldUntil, timeZone) }), settled = run ? run.organized + run.attention.length : 0;
  return <Card tone="soft" style={{ gap: 12 }}>
    <View accessible accessibilityLiveRegion={running ? "polite" : "none"} style={{ gap: 4 }}>
      <Copy kind="heading">{words.heading}</Copy>
      <Copy kind="small" tone="muted">{words.body}</Copy>
    </View>
    {running && <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ height: 8, borderRadius: 4, backgroundColor: c.progressTrack, overflow: "hidden" }}>
      <View style={{ width: `${Math.round((settled / Math.max(1, run!.total)) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: c.progressFill }} />
    </View>}
    {!!error && <Notice error>{error}</Notice>}
    {!run && !held && <Button title={found.length === 1 ? "Organize it" : `Organize all ${found.length}`} icon="sparkles-outline" busy={busy} onPress={() => void start()} />}
    {running && run!.stopped !== "cancelled" && <Button variant="ghost" title="Stop after these"
      onPress={() => void b.commit(stopOrganize).catch((failure) => setError(messageFor(failure)))} />}
    {run?.finished_at && <Button secondary title="Done" onPress={() => void b.commit(clearOrganize).catch((failure) => setError(messageFor(failure)))} />}
  </Card>;
}
