import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, View } from "react-native";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useBaby } from "@/lib/context";
import { addMutation, withoutBirth } from "../lib/outbox";
import { messageFor } from "../lib/models";
import { familySpaces } from "../lib/spaces";
import { birthParts, birthWrite, gramsFrom, welcome } from "../lib/birth";
import { defaultRecipients, memberName, newsAbout, newsAvailable, queueNews, recipientWords, tellable, withoutNews } from "../lib/family-news";
import { undoShown } from "../lib/running-feed";
import type { FamilyMember } from "../lib/family";
import { DateField } from "@/components/date-field";
import { TimeField } from "@/components/time-field";
import { Button, Choice, Copy, Field, Notice, Screen, Section, tap, useToast } from "@/components/ui";

/**
 * "Baby is here": one calm screen, everything but the date optional. The time starts empty: a time of birth is only
 * ever one she chose. Saving keeps it all on this phone first, turns on newborn care at once, and tells the family
 * members she leaves ticked: her partner by default.
 */
export default function Birth() {
  const b = useBaby(), toast = useToast(), { id } = useLocalSearchParams<{ id?: string }>(),
    bootstrap = b.state.bootstrap!, timezone = bootstrap.profile.timezone,
    child = bootstrap.children.find((one) => one.id === id) ?? bootstrap.children.find((one) => !one.birth_date && one.due_date);
  const [name, setName] = useState(child?.name ?? ""),
    [day, setDay] = useState(() => birthParts(new Date().toISOString(), timezone, false).birth_date),
    [time, setTime] = useState<string | null>(null), [lb, setLb] = useState(""), [oz, setOz] = useState(""),
    [members, setMembers] = useState<FamilyMember[] | null>(null), [to, setTo] = useState<string[]>([]),
    [loadError, setLoadError] = useState(false), [tellParents, setTellParents] = useState(true), [error, setError] = useState(""), [saving, setSaving] = useState(false), saved = useRef(false);
  const family = familySpaces(bootstrap).find((space) => space.id === child?.space_id), canTell = !!family && newsAvailable(bootstrap, family.id),
    // No signal in a delivery room: "the other parents" still works, and who they are is read when it goes.
    unread = canTell && (!members || loadError);
  useEffect(() => {
    if (!canTell) return;
    let alive = true;
    b.api.familyMembers(family!.id).then(({ items }) => {
      if (!alive) return;
      // Whoever's phone this is, the person who gave birth is listed but not ticked: she knows. If someone else added
      // the profile, nobody is hidden; it's one tick.
      setMembers(tellable(items, b.owner));
      setTo(defaultRecipients(items, b.owner, newsAbout(child)));
    }).catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
  }, [canTell, family?.id]);
  if (!child) return <Screen title="Baby is here" back><Notice>Add your baby’s profile first, in Settings.</Notice></Screen>;
  const grams = gramsFrom(lb, oz);
  async function save() {
    if (saved.current || !child) return;
    if (grams === "invalid") return setError("Check the weight: pounds, and ounces under 16. Or leave it blank.");
    const today = birthParts(new Date().toISOString(), timezone, true);
    if (time && day === today.birth_date && time > today.birth_time!) return setError("That time hasn’t come yet today. Check the time of birth, or remove it.");
    saved.current = true; setSaving(true); setError("");
    // Sent only after Undo has gone from the screen, however long that is for her: VoiceOver keeps it up longer.
    const shown = undoShown(await AccessibilityInfo.isScreenReaderEnabled().catch(() => false));
    const birth_date = day, birth_time = time, extras = birthWrite(child, name, birth_time, grams),
      birth = Crypto.randomUUID(), news = Crypto.randomUUID(), previous = child.birth_date ?? null, generation = bootstrap.generation,
      before = Object.fromEntries(Object.keys(extras.details ?? {}).map((key) => [key, child.details?.[key as "birth_time"] ?? null])),
      undoFields = { ...(extras.name ? { previous_name: child.name } : {}), ...(extras.details ? { previous_details: before } : {}) };
    try {
      await b.commit((s) => queueNews(addMutation(s, { id: birth, generation, type: "child_birth", child_id: child.id, birth_date, previous, ...extras, ...undoFields }),
        { id: news, news: "birth", child_id: child.id, to: canTell && !unread ? to : [], ...(unread && tellParents ? { parents: true } : {}),
          names: Object.fromEntries((members ?? []).map((member) => [member.app_user_id, memberName(member)])),
          queued_at: new Date().toISOString(), hold_until: new Date(Date.now() + shown + 500).toISOString() }));
      void b.sync();
      tap("success");
      const told = unread ? (tellParents ? "your partner" : "") : canTell && members ? recipientWords(members, to) : "";
      toast(`${welcome(extras.name ?? child.name)}${told ? ` Telling ${told}.` : ""}`, { label: "Undo", until: Date.now() + shown, onPress: async () => {
        try {
          await b.commit((s) => {
            const queued = s.outbox.find((m) => m.id === birth), unsent = withoutNews(s, news);
            if (queued?.type === "child_birth" && !queued.sent) return withoutBirth({ ...unsent, outbox: unsent.outbox.filter((m) => m.id !== birth) }, queued);
            // It may already be on the API. The date goes back the same way, and news of a birth that isn't there doesn't show.
            return addMutation(unsent, { id: Crypto.randomUUID(), generation, type: "child_birth", child_id: child.id, birth_date: previous, previous: birth_date,
              ...(extras.name ? { name: child.name } : {}), ...(extras.details ? { details: before } : {}) });
          });
          void b.sync();
          toast("Undone.");
        } catch (failure) { toast(messageFor(failure)); }
      } });
      router.back();
    } catch (failure) {
      saved.current = false;
      setError(messageFor(failure));
    } finally { setSaving(false); }
  }
  return <Screen title="Baby is here" back
    footer={<Button size="lg" title="Save" busy={saving} onPress={() => void save()} />}>
    {/* One word that never breaks: at the largest text it shrinks to the width instead. */}
    <Copy tone="muted" fit>Congratulations.</Copy>
    <Copy tone="muted">Add what you know now. Everything here but the day can wait, and you can change it later in Settings.</Copy>
    {!!error && <Notice error>{error}</Notice>}
    <Field label="Baby’s name (optional)" value={name} onChange={setName} maxLength={120} capitalize="words" />
    <Section title="Born">
      <DateField label="Day" value={day} dateOnly maximumDate={new Date()} onChange={(value) => value && setDay(value)} />
      <TimeField label="Time of birth (optional)" value={time} placeholder="Add the time of birth" onChange={setTime} />
      {!!time && <Button variant="ghost" title="Remove the time" onPress={() => setTime(null)} />}
    </Section>
    <Section title="Weight (optional)">
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}><Field label="lb" value={lb} onChange={setLb} numeric maxLength={2} /></View>
        <View style={{ flex: 1 }}><Field label="oz" value={oz} onChange={setOz} numeric maxLength={4} /></View>
      </View>
    </Section>
    {canTell && <Section title="Tell your family">
      {unread ? <Choice label="Your partner" detail={loadError ? "No signal right now. They’ll be told once you’re back online." : "Loading your family…"}
          selected={tellParents} onPress={() => setTellParents(!tellParents)} />
        : !members!.length ? <Copy kind="small" tone="muted">No one else is in your family yet.</Copy>
        : members!.map((member) => <Choice key={member.app_user_id} label={memberName(member)} detail={member.role === "parent" ? "Parent" : "Caregiver"}
          selected={to.includes(member.app_user_id)}
          onPress={() => setTo((all) => all.includes(member.app_user_id) ? all.filter((one) => one !== member.app_user_id) : [...all, member.app_user_id])} />)}
      <Copy kind="small" tone="muted">Who’s ticked sees it in Håfa Baby, and gets a notification if they’ve turned them on. Nothing is sent outside your family.</Copy>
    </Section>}
  </Screen>;
}
