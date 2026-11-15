import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { ensureAiConsent } from "@/lib/ai-consent";
import { messageFor, type BabyRecord } from "../lib/models";
import { isCaregiver } from "../lib/spaces";
import { advanceOrganize, clearOrganize, findWaiting, organizeWords, startOrganize, stopOrganize } from "../lib/organize-waiting";
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

/**
 * Saved posts that were never organized, and one tap to organize them all. While it runs, the card is the progress;
 * when it's done, the card says what happened until she dismisses it. `scan` changes when Saved is pulled to refresh.
 */
export function OrganizeWaiting({ scan = 0 }: { scan?: number }) {
  const b = useBaby(), c = useColors(), run = b.state.organizeRun, bootstrap = b.state.bootstrap;
  const [found, setFound] = useState<BabyRecord[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""),
    starting = useRef(false);
  const allowed = !!bootstrap?.ai_available && !isCaregiver(bootstrap), running = !!run && !run.finished_at;
  const latest = useRef(b);
  latest.current = b;
  useEffect(() => {
    if (!allowed || running) return;
    let alive = true;
    findWaiting((offset) => latest.current.api.records({ kind: "source", limit: 100, offset }), latest.current.state)
      .then((rows) => { if (alive && latest.current.current()) setFound(rows); })
      // Nothing to offer is the safe answer: the posts themselves are all still in Saved.
      .catch(() => { if (alive) setFound([]); });
    return () => { alive = false; };
  }, [allowed, running, scan, bootstrap?.generation]);
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
  const words = organizeWords(run, found.length), settled = run ? run.organized + run.attention.length : 0;
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
    {!run && <Button title={found.length === 1 ? "Organize it" : `Organize all ${found.length}`} icon="sparkles-outline" busy={busy} onPress={() => void start()} />}
    {running && run!.stopped !== "cancelled" && <Button variant="ghost" title="Stop after these"
      onPress={() => void b.commit(stopOrganize).catch((failure) => setError(messageFor(failure)))} />}
    {run?.finished_at && <Button secondary title="Done" onPress={() => void b.commit(clearOrganize).catch((failure) => setError(messageFor(failure)))} />}
  </Card>;
}
