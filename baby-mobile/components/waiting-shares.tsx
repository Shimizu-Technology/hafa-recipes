import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, View } from "react-native";
import { useUser } from "@clerk/expo";
import { useBaby } from "@/lib/context";
import * as Share from "@/modules/hafa-baby-share/src";
import { onSharesChanged } from "../lib/share-session-state";
import { addWaitingShares, removeWaitingShare, shareKeptUntil, shareLabel, shareWhen } from "../lib/waiting-shares";
import { Button, Card, Copy, Icon, Notice, PressTarget, radii, tap, useColors, useToast } from "./ui";

/** "Not now" holds until the app is next opened fresh, and only for the account that said it. */
const notNow = new Set<string>();

/**
 * What was shared on this phone while no one was signed in. Nothing leaves the phone until the person signed in says
 * it's theirs, so a share can't reach whoever happens to sign in next. Adding always goes to their own personal space.
 */
export function WaitingShares() {
  const b = useBaby(), c = useColors(), toast = useToast(), { user } = useUser();
  const owner = b.owner, generation = b.state.bootstrap?.generation;
  const [rows, setRows] = useState<Share.WaitingShare[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
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
  if (!rows.length || !owner || !generation) return null;
  const one = rows.length === 1, account = user?.primaryEmailAddress?.emailAddress || "this account";
  async function add() {
    setBusy(true);
    setError("");
    try {
      const added = await addWaitingShares(rows.map((row) => row.token), owner!, generation!, b.current);
      if (added !== rows.length) setError("Some of this couldn’t be added just now. It’s still on this phone.");
      if (added) {
        tap("success");
        toast("Added to your saved posts");
      }
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
    {!!error && <Notice error>{error}</Notice>}
    <Button title={one ? "Add to my saved posts" : `Add all ${rows.length}`} busy={busy} onPress={() => void add()} />
    {one && <Button secondary title="Not mine, remove it" disabled={busy} onPress={() => remove(rows[0].token)} />}
    <Button variant="ghost" title="Not now" disabled={busy} onPress={() => {
      for (const row of rows) notNow.add(`${owner}:${row.token}`);
      setRows([]);
    }} />
  </Card>;
}
