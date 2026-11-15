import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useBaby } from "@/lib/context";
import { ApiError } from "../lib/api";
import type { FamilyMember } from "../lib/family";
import { memberName } from "../lib/family-news";
import { messageFor, type Child } from "../lib/models";
import { familySpaces, rowFence } from "../lib/spaces";
import { Choice, Copy, useToast } from "./ui";

/**
 * "Who's expecting?", asked once where it matters (labor, the birth, the baby's profile), answered for the whole
 * family. The other parents by name, then Me. Saved straight to the baby's profile, so it needs a signal.
 */
export function ExpectingAsk({ child, members, intro = true }: { child: Child; members: readonly FamilyMember[]; intro?: boolean }) {
  const b = useBaby(), toast = useToast(), [busy, setBusy] = useState(false), inFlight = useRef(false),
    parents = members.filter((member) => member.role === "parent" && member.status === "active"),
    options = [...parents.filter((member) => member.app_user_id !== b.owner).map((member) => ({ id: member.app_user_id, label: memberName(member) })),
      ...(b.owner ? [{ id: b.owner, label: "Me" }] : [])],
    chosen = child.details?.expecting_confirmed ? child.details.expecting_member : null;
  async function choose(id: string) {
    // A second tap while the first is on its way would arrive with the old revision and read as a conflict.
    if (inFlight.current || id === chosen) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const generation = b.state.bootstrap!.generation,
        saved = await b.api.child({ id: child.id, revision: child.revision, details: { expecting_member: id, expecting_confirmed: true } }, rowFence(child, generation));
      await b.commit((s) => s.bootstrap ? { ...s, bootstrap: { ...s.bootstrap, children: s.bootstrap.children.map((one) => one.id === saved.id ? saved : one) } } : s);
    } catch (failure) {
      // Someone changed the profile since: read it again, and she can choose once more.
      if (failure instanceof ApiError && failure.status === 409) void Promise.resolve(b.refresh()).catch(() => undefined);
      toast(failure instanceof ApiError && failure.local ? "No signal right now. Choose again once you’re back online." : messageFor(failure));
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <View style={{ gap: 6 }}>
    <Copy kind="label">Who’s expecting?</Copy>
    {intro && <Copy kind="small" tone="muted">So Håfa Baby knows who to tell when labor starts, and whose words to use. Everyone in your family sees the same answer.</Copy>}
    {options.map((option) => <Choice key={option.id} radio label={option.label} selected={chosen === option.id} disabled={busy} onPress={() => void choose(option.id)} />)}
  </View>;
}

/**
 * On the baby's profile before the birth, in a family with another parent: the same choice, to change any time. Only
 * for a parent there: a caregiver can't change a baby's profile, so they're never offered a choice that's refused.
 */
export function ExpectingProfile({ child }: { child: Child }) {
  const b = useBaby(), [members, setMembers] = useState<FamilyMember[] | null>(null),
    inFamily = familySpaces(b.state.bootstrap).some((space) => space.id === child.space_id && space.role === "parent");
  useEffect(() => {
    if (!inFamily || child.birth_date) return;
    let alive = true;
    b.api.familyMembers(child.space_id!).then(({ items }) => { if (alive) setMembers(items); }).catch(() => undefined);
    return () => { alive = false; };
  }, [inFamily, child.space_id, child.birth_date]);
  const parents = (members ?? []).filter((member) => member.role === "parent" && member.status === "active");
  if (!members || parents.length < 2) return null;
  return <ExpectingAsk child={child} members={members} intro={false} />;
}
