import { useEffect, useRef, useState } from "react";
import { Alert, Share, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useBaby } from "@/lib/context";
import { messageFor, type BabyRecord } from "@/lib/models";
import { exportFile } from "@/lib/files";
import { installationId, nativeSharingAvailable } from "@/modules/hafa-baby-share/src";
import { Button, Card, Choice, Copy, Field, Grouped, Loading, Notice, Row, Screen, Section, useToast } from "@/components/ui";
import { ApiError, PhonesNotReady } from "../lib/api";
import { codeFrom, forgetInvite, heldInvite, holdInvite, inviteMessage, whatBecomesShared, type FamilyInvite, type FamilyMember, type FamilyReadiness, type InvitePreview } from "../lib/family";
import { familySpaces, herLog, rowFence, spacesLive } from "../lib/spaces";
import { friendlyDay } from "../lib/family-format";

const everyPage = async (read: (offset: number) => Promise<{ items: BabyRecord[]; has_more: boolean }>) => {
  const rows: BabyRecord[] = [];
  for (let more = true; more;) {
    const page = await read(rows.length);
    rows.push(...page.items);
    more = page.has_more && !!page.items.length;
  }
  return rows;
};
/** Fixed words for what a code can come back with. */
function codeProblem(failure: unknown) {
  if (!(failure instanceof ApiError) || failure.local) return messageFor(failure);
  if (failure.status === 404) return "Family invites aren’t open yet. Nothing has changed.";
  if (failure.status === 409) return "This code has expired or been used. Ask for a new one.";
  if (failure.status === 422) return "That doesn’t look like a family code. Check you copied all of it.";
  if (failure.status === 403) return "Update Håfa Baby to join a family.";
  return messageFor(failure);
}
/** Every signed-in phone has to be on this build before her baby moves: an older one would lose sight of them. */
function PhoneGate({ readiness, failed, busy, onCheck, onForget }: { readiness: FamilyReadiness | null; failed: boolean; busy: boolean; onCheck: () => void; onForget: (id: string) => void }) {
  if (failed || !readiness)
    return <Card><Copy kind="heading">Connect to check your phones</Copy><Copy>Your baby’s profile moves to the family, so every phone signed in to your account needs the update first. This can’t be checked without a connection.</Copy><Button secondary title="Check again" busy={busy} onPress={onCheck} /></Card>;
  const waiting = readiness.phones.filter((phone) => phone.state !== "ready");
  return <Card>
    <Copy kind="heading">Update your other phones first</Copy>
    <Copy>Your baby’s profile moves to the family, and an older Håfa Baby would lose sight of it. Nothing moves until every phone signed in to your account is updated.</Copy>
    {waiting.map((phone) => <View key={phone.id} style={{ gap: 8 }}>
      <Copy kind="small">{phone.this_phone ? "This phone is still connecting. Try again in a moment."
        : `A phone ${phone.last_seen ? `last opened ${friendlyDay(phone.last_seen)}` : "signed in to your account"} needs the update.`}</Copy>
      {!phone.this_phone && <Button variant="ghost" title="I don’t use this phone" disabled={busy} onPress={() => onForget(phone.id)} />}
    </View>)}
    <Button secondary title="Check again" busy={busy} onPress={onCheck} />
  </Card>;
}
function ShownCode({ invite, onDone }: { invite: FamilyInvite; onDone: () => void }) {
  const toast = useToast();
  return <Section title="Send this to them">
    <Card tone="soft">
      <Copy kind="small">{invite.code}</Copy>
      <Copy kind="small" tone="muted">{`It works once, until ${friendlyDay(invite.expires_at)}. This is the only time it’s shown. They need the update too.`}</Copy>
    </Card>
    <Button title="Send the code" icon="share-outline" size="lg" onPress={() => void Share.share({ message: inviteMessage(invite.code!) })} />
    <Button secondary title="Copy" onPress={() => void Clipboard.setStringAsync(invite.code!).then(() => toast("Copied."))} />
    <Button variant="ghost" title="Done" onPress={onDone} />
  </Section>;
}
function Invite({ onBack }: { onBack: () => void }) {
  const b = useBaby(), bootstrap = b.state.bootstrap!, [rows, setRows] = useState<BabyRecord[] | null>(null), [justMe, setJustMe] = useState<string[]>([]),
    [readiness, setReadiness] = useState<FamilyReadiness | null>(null), [failed, setFailed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [invite, setInvite] = useState<FamilyInvite | null>(null);
  async function check() {
    setBusy(true);
    try {
      setReadiness(await b.api.readiness(nativeSharingAvailable ? await installationId() : undefined));
      setFailed(false);
    } catch { setFailed(true); setReadiness(null); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    void check();
    void everyPage((offset) => b.api.records({ limit: 100, offset: offset || undefined })).then(setRows).catch(() => setRows([]));
  }, []);
  function forget(id: string) {
    Alert.alert("Stop waiting for this phone?", "Only do this if nobody uses it. If it’s opened again on an older Håfa Baby, it won’t see your baby until it updates, and anything waiting on it stays on it.", [
      { text: "Keep waiting", style: "cancel" },
      { text: "Stop waiting for it", style: "destructive", onPress: () => void b.api.forgetPhone(id, bootstrap.generation).then(check).catch((failure: unknown) => setError(messageFor(failure))) },
    ]);
  }
  async function create() {
    setBusy(true); setError("");
    try {
      for (const row of rows ?? []) if (justMe.includes(row.id)) await b.api.save({ ...row, data: { ...row.data, just_me: true } }, bootstrap.generation);
      const made = await b.api.createInvite("parent", true, bootstrap.generation);
      holdInvite(made);
      setInvite(made);
      await b.refresh();
      void b.sync();
    } catch (failure) {
      if (failure instanceof PhonesNotReady) setReadiness(failure.readiness);
      else setError(codeProblem(failure));
    } finally { setBusy(false); }
  }
  if (invite) return <ShownCode invite={invite} onDone={() => { forgetInvite(); onBack(); }} />;
  const movable = (rows ?? []).filter((row) => (row.kind === "source" || row.kind === "collection") && !row.data.just_me),
    going = (rows ?? []).filter((row) => !justMe.includes(row.id));
  return <>
    {!!error && <Notice error>{error}</Notice>}
    {!rows ? <Loading label="Checking what you’ve saved…" /> : <>
      <Section title="What becomes shared">
        {whatBecomesShared(going, bootstrap.children.map((child) => child.name)).map((line) => <Copy key={line}>{line}</Copy>)}
        <Copy kind="small" tone="muted">Everyone you invite as a parent can see and change these, and each parent’s Ask can use them when AI is on.</Copy>
      </Section>
      {!!movable.length && <Section title="Saved posts and categories">
        <Copy kind="small" tone="muted">Untick any you’d rather keep to yourself.</Copy>
        {movable.map((row) => <Choice key={row.id} label={row.title} selected={!justMe.includes(row.id)} onPress={() => setJustMe((now) => now.includes(row.id) ? now.filter((id) => id !== row.id) : [...now, row.id])} />)}
      </Section>}
      <Section title="What stays private">
        <Copy>Your journal, your Ask chats{(rows ?? []).some(herLog) ? ", and your own logs like blood pressure" : ""}. Only you can see these, and only your Ask can use them.</Copy>
      </Section>
    </>}
    {readiness?.ready
      ? <Button title="Share and get a code" size="lg" icon="people-outline" busy={busy} disabled={!rows} onPress={() => void create()} />
      : <PhoneGate readiness={readiness} failed={failed} busy={busy} onCheck={() => void check()} onForget={forget} />}
    <Button variant="ghost" title="Not now" disabled={busy} onPress={onBack} />
  </>;
}
function Join({ onBack }: { onBack: () => void }) {
  const b = useBaby(), [code, setCode] = useState(""), [preview, setPreview] = useState<InvitePreview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function look(text = code) {
    setBusy(true); setError(""); setPreview(null);
    try { setPreview(await b.api.previewInvite(codeFrom(text))); }
    catch (failure) { setError(codeProblem(failure)); }
    finally { setBusy(false); }
  }
  async function join() {
    setBusy(true); setError("");
    try {
      await b.api.acceptInvite(codeFrom(code), b.state.bootstrap!.generation);
      await b.refresh();
      void b.sync();
    } catch (failure) { setError(codeProblem(failure)); setBusy(false); }
  }
  return <>
    {!!error && <Notice error>{error}</Notice>}
    {preview ? <Section title={preview.role === "parent" ? "Join as a parent" : "Join as a caregiver"}>
      <Copy>{preview.disclosure}</Copy>
      <Copy>Nothing of yours moves. Your own entries stay in your own space, and you can come back to them if you leave.</Copy>
      <Button title="Join this family" size="lg" icon="people-outline" busy={busy} onPress={() => void join()} />
    </Section> : <Section title="Paste the code you were sent">
      <Button title="Paste" icon="clipboard-outline" size="lg" busy={busy} onPress={() => void Clipboard.getStringAsync().then((text) => { setCode(text); return look(text); })} />
      <Field label="Code" value={code} onChange={setCode} placeholder="hfbi_v1…" />
      <Button secondary title="Check the code" disabled={!code.trim()} busy={busy} onPress={() => void look()} />
    </Section>}
    <Button variant="ghost" title="Not now" disabled={busy} onPress={onBack} />
  </>;
}
/** "Logged by" reads this, so it asks once, here, where it matters. Nothing else needs it. */
function YourName() {
  const b = useBaby(), profile = b.state.bootstrap!.profile, [name, setName] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  if (profile.display_name?.trim() || saved) return null;
  return <Section title="What should they call you?">
    <Copy kind="small" tone="muted">Your family sees this on what you log.</Copy>
    {!!error && <Notice error>{error}</Notice>}
    <Field label="Your name" value={name} onChange={setName} />
    <Button secondary title="Save name" disabled={!name.trim()} busy={busy} onPress={() => { setBusy(true); void b.api.profile({ ...profile, display_name: name.trim() }, b.state.bootstrap!.generation)
      .then(() => { setSaved(true); return b.refresh(); }).catch((failure: unknown) => setError(messageFor(failure))).finally(() => setBusy(false)); }} />
  </Section>;
}
function InFamily() {
  const b = useBaby(), toast = useToast(), bootstrap = b.state.bootstrap!, family = familySpaces(bootstrap)[0], fence = rowFence({ space_id: family.id, generation: family.generation }, bootstrap.generation),
    [members, setMembers] = useState<FamilyMember[] | null>(null), [invites, setInvites] = useState<FamilyInvite[]>([]), [invite, setInvite] = useState<FamilyInvite | null>(heldInvite()), [busy, setBusy] = useState(false), [error, setError] = useState(""), [unread, setUnread] = useState(false),
    parent = family.role === "parent", alive = useRef(true);
  async function load() {
    if (!parent) return setMembers([]);
    try {
      const [people, codes] = await Promise.all([b.api.familyMembers(family.id), b.api.familyInvites(family.id)]);
      if (!alive.current) return;
      setMembers(people.items.filter((member) => member.status === "active"));
      setInvites(codes.items.filter((row) => !row.used_at && !row.revoked_at && new Date(row.expires_at) > new Date()));
      setUnread(false);
    } catch (failure) { if (alive.current) { setError(messageFor(failure)); setUnread(true); } }
  }
  useEffect(() => { void load(); return () => { alive.current = false; }; }, [family.id]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); await load(); }
    catch (failure) { setError(codeProblem(failure)); }
    finally { setBusy(false); }
  }
  // Until the API has said who's here, nobody can be told they're the last parent.
  const parents = (members ?? []).filter((member) => member.role === "parent"), last = parent && members !== null && !unread && parents.length <= 1,
    afterwards = () => b.refresh().then(() => void b.sync());
  if (invite) return <ShownCode invite={invite} onDone={() => { forgetInvite(); setInvite(null); void load(); }} />;
  return <>
    {!!error && <Notice error>{error}</Notice>}
    {unread && <Button secondary title="Try again" disabled={busy} onPress={() => void load()} />}
    {members === null ? (!unread && <Loading label="Opening your family…" />) : !!members.length && <Section title="Who’s here">
      <Grouped>{members.map((member) => <Row key={member.app_user_id} title={member.display_name || "Family member"} detail={member.role === "parent" ? "Parent" : "Caregiver"} icon="person-outline" onPress={() => undefined} />)}</Grouped>
      {parent && members.filter((member) => member.app_user_id !== b.owner).map((member) => <Button key={member.app_user_id} variant="ghost" title={`Remove ${member.display_name || "this person"}`} disabled={busy}
        onPress={() => Alert.alert(`Remove ${member.display_name || "this person"}?`, "They lose access right away, and what they logged stays. If their phone is offline, its copy clears the next time it connects.", [
          { text: "Keep them", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: () => void run(() => b.api.removeMember(family.id, member.app_user_id, fence)) },
        ])} />)}
    </Section>}
    {parent && <Section title="Invite">
      <Button title="Invite someone" icon="person-add-outline" busy={busy} onPress={() => void run(async () => { const made = await b.api.createInvite("parent", false, fence); holdInvite(made); setInvite(made); })} />
      {invites.map((row) => <Button key={row.id} variant="ghost" title={`Cancel the code sent ${friendlyDay(row.expires_at, -7)}`} disabled={busy} onPress={() => void run(() => b.api.revokeInvite(family.id, row.id, fence))} />)}
    </Section>}
    {last ? <Section title="Delete this family">
      <Copy>You’re the last parent, so leaving would leave nobody to look after this. Deleting it erases its babies, logs and saved posts for everyone. It can’t be undone. Your own journal and space stay.</Copy>
      <Button secondary title="Export my Baby data" icon="download-outline" disabled={busy} onPress={() => void run(async () => { await exportFile(await b.api.export(), b.owner); })} />
      <Button variant="destructive" title="Delete this family" disabled={busy} onPress={() => Alert.alert("Delete this family for good?", "Export anything you want to keep first. This can’t be undone.", [
        { text: "Keep it", style: "cancel" },
        { text: "Delete family", style: "destructive", onPress: () => void run(async () => { await b.api.deleteFamily(family.id, fence); await afterwards(); toast("Your family was deleted."); }) },
      ])} />
    </Section> : (members !== null || !parent) && <Button variant="destructive" title="Leave this family" disabled={busy} onPress={() => Alert.alert("Leave this family?", "You lose access right away. Your own journal and space stay yours, and what you logged stays with the family. Ask chats that used the family’s entries are deleted. If another of your phones is offline, its copy clears the next time it connects.", [
      { text: "Stay", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => void run(async () => { await b.api.leaveFamily(family.id, fence); await afterwards(); toast("You left the family."); }) },
    ])} />}
  </>;
}
export default function Family() {
  const b = useBaby(), bootstrap = b.state.bootstrap!, family = familySpaces(bootstrap)[0], [step, setStep] = useState<"start" | "invite" | "join">("start");
  if (!spacesLive(bootstrap)) return <Screen title="Family" back><Notice>Family sharing isn’t open yet. Everything you log stays safe in your own space.</Notice></Screen>;
  if (family) return <Screen title="Family" back><YourName /><InFamily /></Screen>;
  return <Screen title={step === "invite" ? "Invite someone" : step === "join" ? "Join a family" : "Family"} back>
    <YourName />
    {step === "invite" ? <Invite onBack={() => setStep("start")} /> : step === "join" ? <Join onBack={() => setStep("start")} /> : <>
      <Copy>Share your baby’s logs, calendar and saved posts with another parent or a caregiver. They use their own account.</Copy>
      <Button title="Invite someone" icon="person-add-outline" size="lg" onPress={() => setStep("invite")} />
      <Button secondary title="I have a code" icon="key-outline" size="lg" onPress={() => setStep("join")} />
      <Copy kind="small" tone="muted">If you’re no longer in a family, its entries have left this phone. Another phone that’s offline clears its copy the next time it connects.</Copy>
    </>}
  </Screen>;
}
