import type { Workout, Program } from "@/lib/models";
import { useEffect, useRef, useState } from "react";
import { Alert, Share } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Choice, Copy, Field, Notice, Screen, Segmented, Sheet, SkeletonCard } from "@/components/ui";
import { SharedSnapshot } from "@/components/shared-snapshot";
import { useTraining } from "@/lib/context";
import { ApiError } from "@/lib/api";
import type { ShareKind, SharePreview, OwnerShare } from "@/lib/sharing";
import { sharingURL } from "@/lib/sharing";

const lifetimes = ["1", "7", "14", "30"] as const;
type Lifetime = (typeof lifetimes)[number];
const until = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const detail = (e: unknown) => (e instanceof ApiError && e.status === 409 ? e.detail ?? "" : "");

/** One tap to share: the public snapshot previews itself, and "Share link" confirms it and opens the share sheet. */
export default function SharePrescription() {
  const { id, kind: rawKind } = useLocalSearchParams<{ id: string; kind: ShareKind }>();
  const kind = rawKind === "program" ? "program" : "workout";
  const { api, owner, enrollment } = useTraining();
  const q = useQuery<Workout | Program>({
    queryKey: [owner, "share-source", kind, id, enrollment?.generation],
    queryFn: () => (kind === "workout" ? api.workout(id) : api.program(id)),
    enabled: !!enrollment?.enrolled,
  });
  const [title, setTitle] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [days, setDays] = useState<Lifetime>("7");
  const [options, setOptions] = useState(false);
  const [stale, setStale] = useState(false);
  const [request, setRequest] = useState(0);
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [link, setLink] = useState<OwnerShare | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const notReady = !!q.data && kind === "program" && "status" in q.data && q.data.status !== "ready";
  const website = process.env.EXPO_PUBLIC_WORKOUTS_WEBSITE_URL;
  const url = link && !link.revoked_at ? sharingURL(link, website) : "";
  /** Changing an option invalidates the preview; a new one is made when the options sheet closes. */
  function changed() {
    setPreview(null);
    setLink(null);
    setStale(true);
  }
  useEffect(() => {
    if (!q.data || notReady || link) return;
    const data = q.data;
    const mine = ++sequence.current;
    setBusy(true);
    void api
      .previewShare(kind, id, data.revision, {
        title: title.trim() || undefined,
        display_name: name.trim() || undefined,
        include_source_url: source,
        allow_incomplete: incomplete,
        expires_in_days: Number(days),
      }, data.generation)
      .then((next) => {
        if (mine !== sequence.current) return;
        setPreview(next);
        setNeedsReview(false);
      })
      .catch((e) => {
        if (mine !== sequence.current) return;
        if (/needs review/i.test(detail(e))) setNeedsReview(true);
        else setError((e as Error).message);
      })
      .finally(() => { if (mine === sequence.current) setBusy(false); });
    // Options are read when a preview is requested, not on every keystroke.
  }, [q.data, notReady, request]);
  function refresh() {
    setError("");
    setStale(false);
    setPreview(null);
    setRequest((value) => value + 1);
  }
  function closeOptions() {
    setOptions(false);
    if (stale) refresh();
  }
  async function openShareSheet(shareUrl: string) {
    await Share.share({ message: shareUrl }).catch(() => setError("Could not open sharing."));
  }
  async function share() {
    if (link && url) return openShareSheet(url);
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await api.confirmShare(preview);
      setLink(created);
      await openShareSheet(sharingURL(created, website));
    } catch (e) {
      // A preview only lasts a few minutes; make a fresh one to share instead.
      if (/expired|changed/i.test(detail(e))) {
        refresh();
        setError("That preview expired. Here is a fresh one; tap Share link again.");
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    if (!link) return;
    setBusy(true);
    try {
      setLink(await api.revokeShare(link));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const expires = link?.expires_at ?? preview?.link_expires_at;
  return (
    <Screen
      back
      title={kind === "program" ? "Share plan" : "Share workout"}
      subtitle="People with the link see this. Your private notes and history stay private."
      footer={link?.revoked_at ? undefined : (
        <Button title={link ? "Share again" : "Share link"} icon="share-outline" busy={busy && !link}
          disabled={!preview && !link} onPress={() => { void share(); }} />
      )}
    >
      {notReady && <Notice>This plan isn't ready to share yet.</Notice>}
      {needsReview && (
        <>
          <Notice tone="warning">Some details in this {kind === "program" ? "plan" : "workout"} are missing or unclear.</Notice>
          <Choice label="Share it anyway" detail="People will see a note that some details are missing." selected={incomplete}
            onPress={() => { setIncomplete(!incomplete); setLink(null); refresh(); }} />
        </>
      )}
      {preview ? <SharedSnapshot snapshot={preview} /> : busy && !link ? <SkeletonCard lines={4} label="Preparing preview" /> : null}
      {!!expires && !link?.revoked_at && (
        <Copy kind="small" tone="muted">
          {link ? "Link created." : "The link"} works until {until(expires)}. You can turn it off any time in Settings › Sharing links.
        </Copy>
      )}
      {link && (link.revoked_at ? (
        <Notice>This link is off. Copies people already saved stay with them.</Notice>
      ) : (
        <>
          <Copy selectable>{url}</Copy>
          {!website && <Copy kind="small" tone="muted">This build shares an app link; people need Håfa Workouts installed to open it.</Copy>}
          <Button title="Turn off link" variant="ghost" size="sm" inline icon="link-outline" disabled={busy}
            onPress={() => Alert.alert("Turn off this link?", "New visits stop. Copies people already saved stay with them.", [
              { text: "Keep link", style: "cancel" },
              { text: "Turn off", style: "destructive", onPress: () => { void revoke(); } },
            ])} />
        </>
      ))}
      {!link && <Button title="Link options" variant="ghost" size="sm" inline icon="options-outline" disabled={busy && !preview}
        onPress={() => setOptions(true)} />}
      {!!(error || q.error) && <Notice error>{error || q.error?.message}</Notice>}
      <Sheet visible={options} onClose={closeOptions} title="Link options">
        <Field label="Public title" optional value={title} onChange={(v) => { setTitle(v); changed(); }}
          placeholder={kind === "program" ? "Shared training plan" : q.data?.title} />
        <Field label="Shared by" optional value={name} onChange={(v) => { setName(v); changed(); }} placeholder="Your name" />
        <Copy kind="label">Link works for</Copy>
        <Segmented label="Link works for" value={days} onChange={(v) => { setDays(v); changed(); }}
          options={lifetimes.map((value) => ({ value, label: value === "1" ? "1 day" : `${value} days` }))} />
        <Choice label="Include the original source link" selected={source} onPress={() => { setSource(!source); changed(); }} />
        <Button title="Done" onPress={closeOptions} />
      </Sheet>
    </Screen>
  );
}
