import { useEffect, useRef, useState } from "react";
import { Alert, Share, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useBaby } from "@/lib/context";
import { messageFor, type BabyRecord } from "@/lib/models";
import { exportFile } from "@/lib/files";
import { installationId, nativeSharingAvailable } from "@/modules/hafa-baby-share/src";
import { Button, Card, Choice, Copy, Field, Grouped, Loading, Notice, Row, Screen, Section, useToast } from "@/components/ui";
import { ApiError, PhonesNotReady } from "../lib/api";
import { looksLikeCode } from "../lib/family";
import { takeJoinLink } from "../lib/join-link";
import { codeFrom, forgetInvite, heldInvite, holdInvite, inviteMessage, whatBecomesShared, type FamilyInvite, type FamilyMember, type FamilyReadiness, type InvitePreview } from "../lib/family";
import { babyLabel, familyOpen, familySpaces, herLog, rowFence } from "../lib/spaces";
import { leftFamilyNotice } from "../lib/outbox";
import { askForShareSession } from "@/lib/share-session-state";
import { friendlyDay } from "../lib/family-format";
import { sourceTitle } from "../lib/source-title";

const everyPage = async (read: (offset: number) => Promise<{ items: BabyRecord[]; has_more: boolean }>) => {
  const rows: BabyRecord[] = [];
  for (let more = true; more;) {
    const page = await read(rows.length);
    rows.push(...page.items);
    more = page.has_more && !!page.items.length;
  }
  return rows;
};
const notACode = "That doesn’t look like a family code. Check you copied all of it.";
const notALink = "That link doesn’t have a working family code in it. Ask for a new one, or paste the code here.";
/** Fixed words for what a code can come back with. */
function codeProblem(failure: unknown) {
  if (!(failure instanceof ApiError) || failure.local) return messageFor(failure);
  if (failure.status === 404) return "Family invites aren’t open yet. Nothing has changed.";
  if (failure.status === 409) return "This code has expired or been used. Ask for a new one.";
  if (failure.status === 422) return notACode;
  if (failure.status === 403) return "Update Håfa Baby to join a family.";
  return messageFor(failure);
}
/** Leaving, removing and deleting are refused with a 409 when who's here isn't what this screen showed. */
function whoIsHereProblem(failure: unknown) {
  return failure instanceof ApiError && !failure.local && failure.status === 409 ? "Who’s here has changed. Check the list and try again." : codeProblem(failure);
}
type Role = "parent" | "caregiver";
function RoleChoice({ role, onChange, disabled }: { role: Role; onChange: (role: Role) => void; disabled?: boolean }) {
  return <Section title="Who are they?">
    <Choice label="Parent" detail="Sees and changes everything shared, and can invite others" selected={role === "parent"} disabled={disabled} onPress={() => onChange("parent")} />
    <Choice label="Caregiver" detail="Logs care and sees the calendar. Can’t see saved posts or doctor questions, can’t use Ask, and can’t change a baby’s profile" selected={role === "caregiver"} disabled={disabled} onPress={() => onChange("caregiver")} />
  </Section>;
}
/** An older build would lose sight of her baby when it moves. Nothing moves until her phones are updated, or she says one is gone. */
function PhoneGate({ readiness, failed, busy, joining, onCheck, onConfirm }: { readiness: FamilyReadiness | null; failed: boolean; busy: boolean; joining?: boolean; onCheck: () => void; onConfirm: () => void }) {
  if (failed || !readiness)
    return <Card><Copy kind="heading">Connect to check your phones</Copy><Copy>{joining ? "Any phone on your account needs the update before you join." : "Your baby’s profile moves to the family, so any phone on your account needs the update first."} This can’t be checked without a connection.</Copy><Button secondary title="Check again" busy={busy} onPress={onCheck} /></Card>;
  const waiting = readiness.phones.filter((phone) => phone.state !== "ready"), others = waiting.filter((phone) => !phone.this_phone);
  return <Card>
    <Copy kind="heading">Check your phones first</Copy>
    {(!!others.length || !!readiness.older_client_at) && <Copy>{`${readiness.older_client_at ? "This account was used on an older version of Håfa Baby in the last 14 days. " : ""}Update that phone, or tell us it’s gone.`}</Copy>}
    {waiting.map((phone) => <Copy key={phone.id} kind="small">{phone.this_phone ? "This phone is still connecting. Try again in a moment."
      : `A phone ${phone.last_seen ? `last opened ${friendlyDay(phone.last_seen)}` : "signed in to your account"} needs the update.`}</Copy>)}
    {(!!others.length || !!readiness.older_client_at) && <Button variant="ghost" title="That phone is updated or gone" disabled={busy} onPress={onConfirm} />}
    <Button secondary title="Check again" busy={busy} onPress={onCheck} />
  </Card>;
}
/** Whether this account's phones are ready, for the two ways into a family: both are checked, and answered, the same way. */
function usePhones(setError: (message: string) => void) {
  const b = useBaby(), [readiness, setReadiness] = useState<FamilyReadiness | null>(null), [failed, setFailed] = useState(false), [checking, setChecking] = useState(false);
  async function check() {
    setChecking(true);
    try {
      // This phone answers for itself first: a sighting of an older one takes back what it reported.
      // A slow answer doesn't hold up the check, which can say "still connecting" and be asked again.
      await Promise.race([askForShareSession(), new Promise((settle) => setTimeout(settle, 8_000))]);
      setReadiness(await b.api.readiness(nativeSharingAvailable ? await installationId() : undefined));
      setFailed(false);
    } catch { setFailed(true); setReadiness(null); }
    finally { setChecking(false); }
  }
  function confirmPhones() {
    Alert.alert("Is that phone updated, or gone?", "Say yes if it’s updated, or nobody uses it now. If it’s used again on an older Håfa Baby, it won’t see your baby until it updates, and anything waiting on it stays on it.", [
      { text: "Not yet", style: "cancel" },
      { text: "Yes, it’s updated or gone", onPress: () => void (async () => {
        try { await b.api.confirmPhones(nativeSharingAvailable ? await installationId() : undefined); await check(); }
        catch (failure) { setError(failure instanceof ApiError && failure.status === 404 ? codeProblem(failure) : messageFor(failure)); }
      })() },
    ]);
  }
  return { readiness, setReadiness, failed, checking, check, confirmPhones };
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
  const b = useBaby(), bootstrap = b.state.bootstrap!, [rows, setRows] = useState<BabyRecord[] | null>(null), [unread, setUnread] = useState(false), [justMe, setJustMe] = useState<string[]>([]),
    [busy, setBusy] = useState(false), [error, setError] = useState(""), [invite, setInvite] = useState<FamilyInvite | null>(null), [role, setRole] = useState<Role>("parent");
  const { readiness, setReadiness, failed, checking, check, confirmPhones } = usePhones(setError);
  /** What becomes shared is what she's agreeing to, so a list that didn't load stops her, rather than reading as nothing. */
  function readRows() {
    setUnread(false);
    setRows(null);
    void everyPage((offset) => b.api.records({ limit: 100, offset: offset || undefined })).then(setRows).catch(() => setUnread(true));
  }
  useEffect(() => {
    void check();
    readRows();
  }, []);
  async function create() {
    setBusy(true); setError("");
    try {
      for (const row of rows ?? []) if (justMe.includes(row.id)) await b.api.save({ ...row, data: { ...row.data, just_me: true } }, bootstrap.generation);
      const made = await b.api.createInvite(role, true, bootstrap.generation);
      holdInvite(made, b.owner);
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
    <RoleChoice role={role} onChange={setRole} disabled={busy} />
    {unread ? <Card>
      <Notice error>We couldn’t read what would be shared, so nothing has changed.</Notice>
      <Button secondary title="Try again" onPress={() => { readRows(); if (failed) void check(); }} />
    </Card> : !rows ? <Loading label="Checking what you’ve saved…" /> : <>
      <Section title="What becomes shared">
        {whatBecomesShared(going, bootstrap.children.map((child) => child.name)).map((line) => <Copy key={line}>{line}</Copy>)}
        <Copy kind="small" tone="muted">Everyone you invite as a parent can see and change these, and each parent’s Ask can use them when AI is on.</Copy>
      </Section>
      {!!movable.length && <Section title="Saved posts and categories">
        <Copy kind="small" tone="muted">Untick any you’d rather keep to yourself.</Copy>
        {movable.map((row) => <Choice key={row.id} label={row.kind === "source" ? sourceTitle(row) : row.title} selected={!justMe.includes(row.id)} onPress={() => setJustMe((now) => now.includes(row.id) ? now.filter((id) => id !== row.id) : [...now, row.id])} />)}
      </Section>}
      <Section title="What stays private">
        <Copy>Your journal, your Ask chats{(rows ?? []).some(herLog) ? ", and your own logs like blood pressure" : ""}. Only you can see these, and only your Ask can use them.</Copy>
      </Section>
    </>}
    {!readiness?.ready
      ? <PhoneGate readiness={readiness} failed={failed} busy={busy || checking} onCheck={() => void check()} onConfirm={confirmPhones} />
      : !unread && <Button title="Share and get a code" size="lg" icon="people-outline" busy={busy || checking} disabled={!rows} onPress={() => void create()} />}
    <Button variant="ghost" title="Not now" disabled={busy} onPress={onBack} />
  </>;
}
function Join({ link, onBack }: { link: string | null; onBack: () => void }) {
  const b = useBaby(), [code, setCode] = useState(link ?? ""), [preview, setPreview] = useState<InvitePreview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""),
    { readiness, setReadiness, failed, checking, check, confirmPhones } = usePhones(setError);
  async function look(text = code) {
    setError(""); setPreview(null);
    // The API answers anything unknown the same way, so "expired" would send them asking for a new code they don't need.
    if (!looksLikeCode(text)) return setError(notACode);
    setBusy(true);
    try {
      setPreview(await b.api.previewInvite(codeFrom(text)));
      await check();
    }
    catch (failure) { setError(codeProblem(failure)); }
    finally { setBusy(false); }
  }
  // A tapped link is the same as pasting: it's checked straight away, and joining still takes a tap.
  useEffect(() => {
    if (link === "") setError(notALink);
    else if (link) void look(link);
  }, []);
  async function join() {
    setBusy(true); setError("");
    try {
      await b.api.acceptInvite(codeFrom(code), b.state.bootstrap!.generation);
      await b.refresh();
      void b.sync();
    } catch (failure) {
      if (failure instanceof PhonesNotReady) setReadiness(failure.readiness);
      else setError(codeProblem(failure));
      setBusy(false);
    }
  }
  return <>
    {!!error && <Notice error>{error}</Notice>}
    {preview ? <Section title={preview.role === "parent" ? "Join as a parent" : "Join as a caregiver"}>
      {!!preview.invitation && <Copy>{preview.invitation}</Copy>}
      <Copy>{preview.disclosure}</Copy>
      <Copy>Nothing of yours moves. Your own entries stay in your own space, and you can come back to them if you leave.</Copy>
      {preview.role === "caregiver" && <Copy>Ask isn’t part of helping as a caregiver. Your own chats are kept for if you leave.</Copy>}
      {readiness?.ready
        ? <Button title="Join this family" size="lg" icon="people-outline" busy={busy} onPress={() => void join()} />
        : <PhoneGate joining readiness={readiness} failed={failed} busy={busy || checking} onCheck={() => void check()} onConfirm={confirmPhones} />}
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
    [members, setMembers] = useState<FamilyMember[] | null>(null), [invites, setInvites] = useState<FamilyInvite[]>([]), [invite, setInvite] = useState<FamilyInvite | null>(heldInvite(b.owner, family.id)), [busy, setBusy] = useState(false), [error, setError] = useState(""), [unread, setUnread] = useState(false), [role, setRole] = useState<Role>("parent"),
    parent = family.role === "parent", alive = useRef(true);
  async function load(quiet = false) {
    if (!parent) return setMembers([]);
    try {
      const [people, codes] = await Promise.all([b.api.familyMembers(family.id), b.api.familyInvites(family.id)]);
      if (!alive.current) return;
      setMembers(people.items.filter((member) => member.status === "active"));
      setInvites(codes.items.filter((row) => !row.used_at && !row.revoked_at && new Date(row.expires_at) > new Date()));
      setUnread(false);
    } catch (failure) { if (alive.current && !quiet) { setError(messageFor(failure)); setUnread(true); } }
  }
  // Someone can join or leave while this is open, and it decides whether she's offered Leave or Delete.
  useEffect(() => {
    void load();
    const again = setInterval(() => void load(true), 30_000);
    return () => { alive.current = false; clearInterval(again); };
  }, [family.id]);
  async function run(action: () => Promise<unknown>, problem = codeProblem) {
    setBusy(true); setError("");
    try { await action(); await load(); }
    catch (failure) {
      setError(problem(failure));
      if (problem === whoIsHereProblem) await load(true);
    }
    finally { setBusy(false); }
  }
  // Until the API has said who's here, nobody can be told they're the last parent.
  const parents = (members ?? []).filter((member) => member.role === "parent"), last = parent && members !== null && !unread && parents.length <= 1,
    afterwards = () => b.refresh().then(() => void b.sync());
  if (invite) return <ShownCode invite={invite} onDone={() => { forgetInvite(); setInvite(null); void load(); }} />;
  const ownBabies = bootstrap.children.filter((child) => child.space_id === bootstrap.personal_space_id && !b.state.personalBabiesKept?.includes(child.id));
  return <>
    {!!error && <Notice error>{error}</Notice>}
    {ownBabies.map((child) => <Section key={child.id} title="Your own profile">
      <Copy>{`${babyLabel(child, bootstrap)} is your own profile. It stays private, and what you log for it isn’t in the family. Logs start on the family’s baby now.`}</Copy>
      <Button secondary title="Keep it separate" onPress={() => void b.commit((s) => ({ ...s, personalBabiesKept: [...(s.personalBabiesKept ?? []), child.id] }))} />
      <Button variant="ghost" title="Open its profile" onPress={() => router.push({ pathname: "/child", params: { id: child.id } })} />
    </Section>)}
    {unread ? <Button secondary title="Try again" disabled={busy} onPress={() => void load()} /> : members === null ? <Loading label="Opening your family…" /> : !!members.length && <Section title="Who’s here">
      <Grouped>{members.map((member) => <Row key={member.app_user_id} title={member.display_name || "Family member"} detail={member.role === "parent" ? "Parent" : "Caregiver"} icon="person-outline" onPress={() => undefined} />)}</Grouped>
      {parent && members.filter((member) => member.app_user_id !== b.owner).map((member) => <Button key={member.app_user_id} variant="ghost" title={`Remove ${member.display_name || "this person"}`} disabled={busy}
        onPress={() => Alert.alert(`Remove ${member.display_name || "this person"}?`, member.role === "parent"
          ? "They’re a parent here. They lose the family’s baby, logs, saved posts and calendar right away, and only an invite from a parent here brings them back. What they logged stays, and so does their own journal. If their phone is offline, its copy clears the next time it connects."
          : "They lose access right away, and what they logged stays. If their phone is offline, its copy clears the next time it connects.", [
          { text: "Keep them", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: () => void run(() => b.api.removeMember(family.id, member.app_user_id, fence), whoIsHereProblem) },
        ])} />)}
    </Section>}
    {!parent && <Section title="You’re helping as a caregiver">
      <Copy>You can log care and see the calendar. Saved posts and doctor questions stay with the parents, and a parent changes a baby’s profile. Ask isn’t part of helping, and your own chats are kept for if you leave.</Copy>
    </Section>}
    {parent && !unread && members !== null && <RoleChoice role={role} onChange={setRole} disabled={busy} />}
    {parent && !unread && members !== null && <Section title="Invite">
      <Button title="Invite someone" icon="person-add-outline" busy={busy} onPress={() => void run(async () => { const made = await b.api.createInvite(role, false, fence); holdInvite(made, b.owner); setInvite(made); })} />
      {invites.map((row) => <Button key={row.id} variant="ghost" title={`Cancel the code sent ${friendlyDay(row.expires_at, -7)}`} disabled={busy} onPress={() => void run(() => b.api.revokeInvite(family.id, row.id, fence))} />)}
    </Section>}
    {last ? <Section title="Delete this family">
      <Copy>You’re the last parent, so leaving would leave nobody to look after this. Deleting it erases its babies, logs and saved posts for everyone. It can’t be undone. Your own journal and space stay.</Copy>
      <Button secondary title="Export my Baby data" icon="download-outline" disabled={busy} onPress={() => void run(async () => { await exportFile(await b.api.export(), b.owner); })} />
      <Button variant="destructive" title="Delete this family" disabled={busy} onPress={() => Alert.alert("Delete this family for good?", "Export anything you want to keep first. This can’t be undone.", [
        { text: "Keep it", style: "cancel" },
        { text: "Delete family", style: "destructive", onPress: () => void run(async () => { await b.api.deleteFamily(family.id, fence); await afterwards(); toast("Your family was deleted."); }, whoIsHereProblem) },
      ])} />
    </Section> : !unread && members !== null && <Button variant="destructive" title="Leave this family" disabled={busy} onPress={() => Alert.alert("Leave this family?", "You lose access right away. Your own journal and space stay yours, and what you logged stays with the family. Ask chats that used the family’s entries are deleted. If another of your phones is offline, its copy clears the next time it connects.", [
      { text: "Stay", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => void run(async () => { await b.api.leaveFamily(family.id, fence); await afterwards(); toast("You left the family."); }, whoIsHereProblem) },
    ])} />}
  </>;
}
export default function Family() {
  const b = useBaby(), bootstrap = b.state.bootstrap!, family = familySpaces(bootstrap)[0], [link] = useState(takeJoinLink), [step, setStep] = useState<"start" | "invite" | "join">(link === null ? "start" : "join"),
    [alreadyIn] = useState(link !== null && !!family);
  if (!familyOpen(bootstrap)) return <Screen title="Family" back><Notice>{link === null ? "Family sharing isn’t open yet. Everything you log stays safe in your own space."
    : "Family sharing isn’t open on your account yet, so this invitation wasn’t used. Everything you log stays safe in your own space. Try the link again later."}</Notice></Screen>;
  if (family) return <Screen title="Family" back>{alreadyIn && <Notice>You’re already in a family, so this invitation wasn’t used.</Notice>}<YourName /><InFamily /></Screen>;
  return <Screen title={step === "invite" ? "Invite someone" : step === "join" ? "Join a family" : "Family"} back>
    {step !== "start" && <YourName />}
    {step === "invite" ? <Invite onBack={() => setStep("start")} /> : step === "join" ? <Join link={link} onBack={() => setStep("start")} /> : <>
      <Section title="Share with your family">
        <Copy>Log feeds and appointments together, and each keep your own journal.</Copy>
        <Button title="Invite someone" icon="person-add-outline" size="lg" onPress={() => setStep("invite")} />
        <Button secondary title="I have a code" icon="key-outline" size="lg" onPress={() => setStep("join")} />
      </Section>
      <YourName />
      {!!b.state.feedNotices?.includes(leftFamilyNotice) && <Copy kind="small" tone="muted">You’re no longer in a family, so its entries have left this phone. Another phone that’s offline clears its copy the next time it connects.</Copy>}
    </>}
  </Screen>;
}
