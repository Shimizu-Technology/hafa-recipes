import { useState } from "react";
import { Alert } from "react-native";
import { useBaby } from "@/lib/context";
import { messageFor, type BabyRecord } from "@/lib/models";
import { replaceRecord } from "@/lib/outbox";
import { Choice, Copy, Notice, Section, useToast } from "@/components/ui";
import { canBeJustMe } from "../lib/family";
import { loggedByName } from "../lib/logged-by";
import { familySpaces, rowFence } from "../lib/spaces";
import { canMoveEntry, sharedDetail } from "../lib/writing-places";

/** Shared with family, or Just me: moving a saved post, category or journal entry between spaces. */
export function ShareToggle({ record }: { record: BabyRecord }) {
  const b = useBaby(), toast = useToast(), bootstrap = b.state.bootstrap!, family = familySpaces(bootstrap)[0], [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!family || family.role !== "parent" || !canBeJustMe(record.kind) || !bootstrap.personal_space_id) return null;
  const shared = record.space_id === family.id;
  async function move(destination: string) {
    setBusy(true); setError("");
    try {
      const moved = await b.api.moveRecord(record, destination, rowFence(record, bootstrap.generation));
      await b.commit((s) => ({ ...s, records: replaceRecord(s.records, moved) }));
      toast(destination === family.id ? "Shared with your family." : "Just for you now.");
    } catch (failure) { setError(messageFor(failure)); }
    finally { setBusy(false); }
  }
  function choose(toFamily: boolean) {
    if (busy || toFamily === shared) return;
    if (b.state.outbox.some((m) => (m.type === "save" || m.type === "delete") && m.record.id === record.id)) return setError("This entry is still syncing. Try again in a moment.");
    // A visit is in one place or the other, so the link can't come along. Nothing else on the way says so.
    const visit = !!record.data.event_id;
    if (toFamily) return visit ? Alert.alert("Share this with your family?", "It comes off its visit, which is just for you.", [
      { text: "Keep it just for me", style: "cancel" },
      { text: "Share", onPress: () => void move(family.id) },
    ]) : void move(family.id);
    Alert.alert("Make this just for you?", `Your family won’t see it any more.${visit ? " It comes off its visit, which stays shared." : ""} Answers Ask already gave in other chats may still mention this.`, [
      { text: "Keep it shared", style: "cancel" },
      { text: "Just me", onPress: () => void move(bootstrap.personal_space_id!) },
    ]);
  }
  // Someone else's to change: the API would refuse, so it's said rather than offered.
  if (shared && !canMoveEntry(record, b.owner)) return <Section title="Who can see this">
    <Copy tone="muted">{`Shared with your family by ${loggedByName(record, bootstrap, b.owner)}. Only they can change who sees it.`}</Copy>
  </Section>;
  return <Section title="Who can see this">
    {!!error && <Notice error>{error}</Notice>}
    <Choice label="Shared with family" detail={sharedDetail(record.kind)} selected={shared} disabled={busy} onPress={() => choose(true)} />
    <Choice label="Just me" selected={!shared} disabled={busy} onPress={() => choose(false)} />
  </Section>;
}
