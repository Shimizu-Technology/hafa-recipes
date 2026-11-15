import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import type { Child } from "../lib/models";
import { callLines, contactsOn, deliveryMatters } from "../lib/contacts";
import { defaultRecipients, memberName, newsAvailable, queueNews, recipientWords, tellable, withoutNews } from "../lib/family-news";
import type { FamilyMember } from "../lib/family";
import { familySpaces, isCaregiver } from "../lib/spaces";
import { findBag, packedLine } from "../lib/hospital-bag";
import { whenToCall } from "../lib/labor";
import { undoWindow } from "../lib/running-feed";
import { CallContact } from "@/components/call-contact";
import { MedicalSource } from "./medical-source";
import { Button, Choice, Copy, QuietRow, Row, Section, tap, useToast } from "./ui";

/**
 * Labor in one place, under the timer: tell Leon in one tap, when to call (her provider's word first), the numbers
 * she saved, and the bag. Nothing here reads the timer and says it's time; that's her care team's call.
 */
export function LaborCard({ child, today, running, week }: { child: Child | null; today: Date; running: boolean; week?: number }) {
  const b = useBaby(), toast = useToast(), bootstrap = b.state.bootstrap, bag = findBag(b.records),
    family = child ? familySpaces(bootstrap).find((space) => space.id === child.space_id) : undefined,
    canTell = !!child && !!family && newsAvailable(bootstrap, family.id) && !child.birth_date;
  const [members, setMembers] = useState<FamilyMember[] | null>(null), [choosing, setChoosing] = useState(false),
    [picked, setPicked] = useState<string[]>([]), [told, setTold] = useState(""), [unread, setUnread] = useState(false), sending = useRef(false);
  useEffect(() => {
    if (!canTell) return;
    let alive = true;
    b.api.familyMembers(family!.id).then(({ items }) => { if (alive) setMembers(tellable(items, b.owner)); }).catch(() => { if (alive) setUnread(true); });
    return () => { alive = false; };
  }, [canTell, family?.id]);
  const partners = members ? defaultRecipients(members, null) : [], others = (members ?? []).filter((member) => !partners.includes(member.app_user_id));
  /** No list means no signal: "the other parents" are looked up as it goes. It waits out Undo first, so Undo really takes it back. */
  async function tell(to: string[] | "parents") {
    if (!child || !to.length || sending.current) return;
    sending.current = true;
    const id = Crypto.randomUUID(), who = to === "parents" ? "Your partner" : recipientWords(members ?? [], to),
      // Only the partner button says "Told …": telling Grandma mustn't relabel the button that tells Leon.
      partner = to === "parents" || to === partners;
    try {
      await b.commit((s) => queueNews(s, { id, news: "labor", child_id: child.id, to: to === "parents" ? [] : to, ...(to === "parents" ? { parents: true } : {}),
        queued_at: new Date().toISOString(), hold_until: new Date(Date.now() + undoWindow(false)).toISOString() }));
      tap("success");
      if (partner) setTold(who);
      setChoosing(false); setPicked([]);
      toast(`${who} will get a notification${to === "parents" ? " once you’re back online" : ""}.`, { label: "Undo", onPress: () => void b.commit((s) => withoutNews(s, id)).then(() => { if (partner) setTold(""); }) });
    } catch { toast("That couldn’t be kept on this phone. Try again."); }
    finally { sending.current = false; }
  }
  const lines = callLines(bootstrap, today).filter((line) => line.key === "delivery" || line.key === "doctor");
  return <Section title="When it’s time">
    {canTell && !members && unread && <Button title={told ? "Told your partner. Tell again" : "Tell your partner"} icon="notifications-outline"
      onPress={() => void tell("parents")} />}
    {canTell && !members && unread && <Copy kind="small" tone="muted">No signal right now. They’ll be told once you’re back online.</Copy>}
    {canTell && members && (partners.length ? <Button title={told ? `Told ${told}. Tell again` : `Tell ${recipientWords(members, partners)}`} icon="notifications-outline"
      onPress={() => void tell(partners)} /> : !others.length ? null : !choosing && <Button secondary title="Tell your family" icon="notifications-outline" onPress={() => setChoosing(true)} />)}
    {canTell && members && others.length > 0 && (choosing ? <View style={{ gap: 4 }}>
      {others.map((member) => <Choice key={member.app_user_id} label={memberName(member)} selected={picked.includes(member.app_user_id)}
        onPress={() => setPicked((all) => all.includes(member.app_user_id) ? all.filter((one) => one !== member.app_user_id) : [...all, member.app_user_id])} />)}
      <Button secondary title={picked.length ? `Tell ${recipientWords(others, picked)}` : "Choose who to tell"} disabled={!picked.length} onPress={() => void tell(picked)} />
    </View> : partners.length > 0 && <Button variant="ghost" title="Tell someone else too" onPress={() => setChoosing(true)} />)}
    {canTell && <Copy kind="small" tone="muted">They get a notification from Håfa Baby saying there’s news. Nothing is sent outside your family.</Copy>}
    {!canTell && !running && !!child && !child.birth_date && !family && !isCaregiver(bootstrap) && <QuietRow title="Invite your partner to tell them from here"
      detail="Settings, then Family" onPress={() => router.push("/family")} />}
    <View style={{ gap: 2 }}>
      <Copy kind="label">When to call</Copy>
      {whenToCall(week).map((line) => <View key={line.text} style={{ gap: 0 }}>
        <Copy kind="small">{line.text}</Copy>
        <MedicalSource source={line.source.name} url={line.source.url} />
      </View>)}
    </View>
    {lines.map((line) => <CallContact key={line.key} line={line} />)}
    {/* Not mid-contraction. */}
    {!running && !lines.some((line) => line.key === "delivery") && contactsOn(bootstrap) && deliveryMatters(bootstrap, today) &&
      <QuietRow title="Add where you plan to deliver" onPress={() => router.push({ pathname: "/profile", params: { open: "delivery" } })} />}
    <Row title="Hospital bag" numericDetail detail={bag ? packedLine(bag) : "A starter list to pack from"} icon="bag-handle-outline"
      onPress={() => router.push("/hospital-bag")} />
  </Section>;
}
