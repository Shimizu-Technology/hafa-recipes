import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, View } from "react-native";
import { useUser } from "@clerk/expo";
import { useBaby } from "@/lib/context";
import * as Share from "@/modules/hafa-baby-share/src";
import { onClaimSettled, onSharesChanged } from "../lib/share-session-state";
import { addWaitingShares, blockedReason, expiredNotice, removeBlockedShare, removeWaitingShare, shareKeptUntil, shareLabel, shareWhen } from "../lib/waiting-shares";
import { Button, Card, Copy, Icon, Notice, PressTarget, radii, tap, useColors, useToast } from "./ui";

/** "Not now" holds until the app is next opened fresh, and only for the account that said it. */
const notNow = new Set<string>();

/**
 * What was shared on this phone while no one was signed in. Nothing leaves the phone until the person signed in says
 * it's theirs, so a share can't reach whoever happens to sign in next. Adding always goes to their own personal space.
 */
export function WaitingShares() {
  return <>
    <BlockedShares />
    <ConfirmWaiting />
  </>;
}
/** A share the app can never take, set aside so the rest keep coming. Trying again wouldn't help, so this offers no such thing. */
function BlockedShares() {
  const b = useBaby(), c = useColors(), owner = b.owner;
  const [rows, setRows] = useState<Share.WaitingShare[]>([]), [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!owner) return setRows([]);
    const next = await Share.blockedShares(owner).catch(() => [] as Share.WaitingShare[]);
    if (b.current()) setRows(next.filter((row) => !notNow.has(`${owner}:${row.token}`)));
  }, [owner]);
  useEffect(() => {
    void load();
    const stop = onSharesChanged(() => void load());
    return stop;
  }, [load]);
  if (!owner) return null;
  const remove = (token: string) => Alert.alert("Remove from this phone?", "It hasn’t gone anywhere else. This can’t be undone.", [
    { text: "Keep it", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: () => void removeBlockedShare(token, owner).catch(() => setError("That couldn’t be removed just now. Try again.")) },
  ]);
  return <>{rows.map((row) => <Card key={row.token} style={{ gap: 12 }}>
    <Copy kind="heading">This share couldn’t be added</Copy>
    <View style={{ gap: 2, padding: 12, borderRadius: radii.thumb, backgroundColor: c.tile }}>
      <Copy kind="label">{shareLabel(row)}</Copy>
      <Copy kind="small" tone="muted">{blockedReason(row)}</Copy>
    </View>
    <Copy kind="small" tone="muted">Your other shares are still coming through.</Copy>
    {!!error && <Notice error>{error}</Notice>}
    <Button secondary title="Remove it" onPress={() => remove(row.token)} />
    <Button variant="ghost" title="Not now" onPress={() => {
      notNow.add(`${owner}:${row.token}`);
      setRows((all) => all.filter((other) => other.token !== row.token));
    }} />
  </Card>)}</>;
}
function ConfirmWaiting() {
  const b = useBaby(), c = useColors(), toast = useToast(), { user } = useUser();
  const owner = b.owner, generation = b.state.bootstrap?.generation;
  const [rows, setRows] = useState<Share.WaitingShare[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""),
    [adding, setAdding] = useState(false), [gone, setGone] = useState("");
  // What's been claimed and is on its way into the outbox. Nothing's announced until it's there.
  const settling = useRef({ waiting: new Set<string>(), saved: 0 });
  const latest = useRef(b), alive = useRef(true);
  latest.current = b;
  const load = useCallback(async () => {
    if (!owner) return setRows([]);
    const next = await Share.waitingShares(owner).catch(() => [] as Share.WaitingShare[]);
    if (b.current()) setRows(next.filter((row) => !notNow.has(`${owner}:${row.token}`)));
  }, [owner]);
  useEffect(() => {
    void load();
    const app = AppState.addEventListener("change", (state) => { if (state === "active") void load(); });
    const stop = onSharesChanged(() => void load());
    return () => { app.remove(); stop(); };
  }, [load]);
  useEffect(() => {
    alive.current = true;
    const stop = onClaimSettled((token, outcome) => {
      const now = settling.current;
      if (!now.waiting.delete(token)) return;
      if (outcome === "saved") now.saved++;
      if (now.waiting.size) return;
      setAdding(false);
      if (now.saved) {
        tap("success");
        toast("Added to your saved posts");
      }
      // A failure has its own alert, and a share the app can't take gets its own card.
      if (outcome === "gone") setError("That share is no longer on this phone.");
    });
    return () => { alive.current = false; stop(); };
  }, []);
  if (!owner || !generation) return null;
  if (adding) return <Card style={{ gap: 4 }}>
    <Copy kind="label">Adding to your saved posts…</Copy>
    <Copy kind="small" tone="muted">It’s safe on this phone.</Copy>
  </Card>;
  if (!rows.length) return gone || error ? <Card style={{ gap: 12 }}>
    <Notice error={!gone}>{gone || error}</Notice>
    <Button variant="ghost" title="OK" onPress={() => { setGone(""); setError(""); }} />
  </Card> : null;
  const one = rows.length === 1, account = user?.primaryEmailAddress?.emailAddress || "this account";
  async function add() {
    setBusy(true);
    setError("");
    setGone("");
    try {
      // Fenced by this card still being mounted, for this account, on this space: claiming under an old one would only lose it.
      const result = await addWaitingShares(rows.map((row) => row.token), owner!, generation!, () =>
        alive.current && latest.current.current() && latest.current.owner === owner && latest.current.state.bootstrap?.generation === generation);
      if (result.claimed.length) {
        settling.current = { waiting: new Set(result.claimed), saved: 0 };
        setAdding(true);
      }
      if (result.expired) setGone(expiredNotice(result.expired));
      if (result.refused) setError("Some of this couldn’t be added just now. It’s still on this phone.");
    } catch {
      setError("This couldn’t be added just now. It’s still on this phone.");
    } finally {
      setBusy(false);
      await load();
    }
  }
  const remove = (token: string) => Alert.alert("Remove from this phone?", "It hasn’t gone anywhere else. This can’t be undone.", [
    { text: "Keep it", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: () => void removeWaitingShare(token).catch(() => setError("That couldn’t be removed just now. Try again.")) },
  ]);
  return <Card style={{ gap: 12 }}>
    <View style={{ gap: 4 }}>
      <Copy kind="heading">{one ? "Add this to your saved posts?" : `Add these ${rows.length} to your saved posts?`}</Copy>
      <Copy kind="small" tone="muted">{one ? "It was shared on this phone while no one was signed in." : "They were shared on this phone while no one was signed in."}</Copy>
    </View>
    <View style={{ gap: 6 }}>
      {rows.map((row) => <View key={row.token} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingLeft: 12, paddingRight: one ? 12 : 4, borderRadius: radii.thumb, backgroundColor: c.tile }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Copy kind="label">{shareLabel(row)}</Copy>
          <Copy numeric kind="small" tone="muted">{one ? `${shareWhen(row)} · ${shareKeptUntil(row)}` : shareWhen(row)}</Copy>
        </View>
        {!one && <PressTarget accessibilityRole="button" accessibilityLabel={`Remove ${shareLabel(row)}`} disabled={busy} onPress={() => remove(row.token)}
          style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
          <Icon name="close" size={20} color={c.muted} />
        </PressTarget>}
      </View>)}
    </View>
    <Copy kind="small" tone="muted">{`Adding to ${account}. Only you will see ${one ? "it" : "them"}.`}</Copy>
    {!!gone && <Notice>{gone}</Notice>}
    {!!error && <Notice error>{error}</Notice>}
    <Button title={one ? "Add to my saved posts" : `Add all ${rows.length}`} busy={busy} onPress={() => void add()} />
    {one && <Button secondary title="Not mine, remove it" disabled={busy} onPress={() => remove(rows[0].token)} />}
    <Button variant="ghost" title="Not now" disabled={busy} onPress={() => {
      for (const row of rows) notNow.add(`${owner}:${row.token}`);
      setRows([]);
    }} />
  </Card>;
}
