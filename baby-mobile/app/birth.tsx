import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useBaby } from "@/lib/context";
import { addMutation, withoutBirth } from "../lib/outbox";
import { messageFor } from "../lib/models";
import { familySpaces } from "../lib/spaces";
import { birthParts, birthWrite, gramsFrom, welcome } from "../lib/birth";
import { defaultRecipients, memberName, newsAvailable, queueNews, recipientWords, tellable, withoutNews } from "../lib/family-news";
import type { FamilyMember } from "../lib/family";
import { DateField } from "@/components/date-field";
import { Button, Chips, Choice, Copy, Field, Notice, Screen, Section, tap, useToast } from "@/components/ui";

/**
 * "Baby is here": one calm screen, everything but the date optional. Saving keeps it all on this phone first, turns
 * on newborn care at once, and tells the family members she leaves ticked: her partner by default.
 */
export default function Birth() {
  const b = useBaby(), toast = useToast(), { id } = useLocalSearchParams<{ id?: string }>(),
    bootstrap = b.state.bootstrap!, timezone = bootstrap.profile.timezone,
    child = bootstrap.children.find((one) => one.id === id) ?? bootstrap.children.find((one) => !one.birth_date && one.due_date);
  const [name, setName] = useState(child?.name ?? ""), [born, setBorn] = useState(() => new Date().toISOString()),
    [day, setDay] = useState(() => birthParts(new Date().toISOString(), timezone, false).birth_date),
    [timeKnown, setTimeKnown] = useState(true), [lb, setLb] = useState(""), [oz, setOz] = useState(""),
    [members, setMembers] = useState<FamilyMember[] | null>(null), [to, setTo] = useState<string[]>([]),
    [loadError, setLoadError] = useState(false), [error, setError] = useState(""), [saving, setSaving] = useState(false), saved = useRef(false);
  const family = familySpaces(bootstrap).find((space) => space.id === child?.space_id), canTell = !!family && newsAvailable(bootstrap);
  useEffect(() => {
    if (!canTell) return;
    let alive = true;
    b.api.familyMembers(family!.id).then(({ items }) => {
      if (!alive) return;
      setMembers(tellable(items, b.owner));
      setTo(defaultRecipients(items, b.owner));
    }).catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
  }, [canTell, family?.id]);
  if (!child) return <Screen title="Baby is here" back><Notice>Add your baby’s profile first, in Settings.</Notice></Screen>;
  const grams = gramsFrom(lb, oz);
  async function save() {
    if (saved.current || !child) return;
    if (grams === "invalid") return setError("Check the weight: pounds, and ounces under 16. Or leave it blank.");
    saved.current = true; setSaving(true); setError("");
    const parts = birthParts(born, timezone, timeKnown), birth_date = timeKnown ? parts.birth_date : day, birth_time = parts.birth_time, extras = birthWrite(child, name, birth_time, grams),
      birth = Crypto.randomUUID(), news = Crypto.randomUUID(), previous = child.birth_date ?? null, generation = bootstrap.generation;
    try {
      await b.commit((s) => queueNews(addMutation(s, { id: birth, generation, type: "child_birth", child_id: child.id, birth_date, previous, ...extras }),
        { id: news, news: "birth", child_id: child.id, to: canTell ? to : [], queued_at: new Date().toISOString() }));
      void b.sync();
      tap("success");
      const told = canTell && members ? recipientWords(members, to) : "";
      toast(`${welcome(extras.name ?? child.name)}${told ? ` Telling ${told}.` : ""}`, { label: "Undo", onPress: async () => {
        try {
          await b.commit((s) => {
            const queued = s.outbox.find((m) => m.id === birth), unsent = withoutNews(s, news);
            if (queued?.type === "child_birth" && !queued.sent) return withoutBirth({ ...unsent, outbox: unsent.outbox.filter((m) => m.id !== birth) }, queued);
            // It may already be on the API. The date goes back the same way, and news of a birth that isn't there doesn't show.
            return addMutation(unsent, { id: Crypto.randomUUID(), generation, type: "child_birth", child_id: child.id, birth_date: previous, previous: birth_date });
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
    <Copy tone="muted">Congratulations. Add what you know now. Everything here but the day can wait, and you can change it later in Settings.</Copy>
    {!!error && <Notice error>{error}</Notice>}
    <Field label="Baby’s name (optional)" value={name} onChange={setName} maxLength={120} capitalize="words" />
    <Section title="Born">
      <Chips label="Time of birth" value={timeKnown ? "time" : "day"} onChange={(value) => {
        // Moving between the two keeps the same day.
        if (value === "day") setDay(birthParts(born, timezone, false).birth_date);
        setTimeKnown(value === "time");
      }}
        options={[{ label: "With the time", value: "time" }, { label: "Just the day", value: "day" }]} />
      {timeKnown ? <DateField label="Day and time" value={born} timeZone={timezone} maximumDate={new Date()} onChange={(value) => value && setBorn(value)} />
        : <DateField label="Day" value={day} dateOnly maximumDate={new Date()} onChange={(value) => value && setDay(value)} />}
    </Section>
    <Section title="Weight (optional)">
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}><Field label="lb" value={lb} onChange={setLb} numeric maxLength={2} /></View>
        <View style={{ flex: 1 }}><Field label="oz" value={oz} onChange={setOz} numeric maxLength={4} /></View>
      </View>
    </Section>
    {canTell && <Section title="Tell your family">
      {loadError ? <Copy kind="small" tone="muted">Your family couldn’t be loaded just now. They’ll still see the news when they open the app.</Copy>
        : !members ? <Copy kind="small" tone="muted">Loading your family…</Copy>
        : !members.length ? <Copy kind="small" tone="muted">No one else is in your family yet.</Copy>
        : members.map((member) => <Choice key={member.app_user_id} label={memberName(member)} detail={member.role === "parent" ? "Parent" : "Caregiver"}
          selected={to.includes(member.app_user_id)}
          onPress={() => setTo((all) => all.includes(member.app_user_id) ? all.filter((one) => one !== member.app_user_id) : [...all, member.app_user_id])} />)}
      <Copy kind="small" tone="muted">Who’s ticked gets a notification from Håfa Baby saying there’s news. Nothing is sent outside your family.</Copy>
    </Section>}
  </Screen>;
}
