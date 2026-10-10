import type { Workout, Program } from "@/lib/models";
import { useState } from "react";
import { Share } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Choice, Copy, Field, Notice, Screen } from "@/components/ui";
import { SharedSnapshot } from "@/components/shared-snapshot";
import { useTraining } from "@/lib/context";
import type { ShareKind, SharePreview, OwnerShare } from "@/lib/sharing";
import { sharingURL } from "@/lib/sharing";
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
  const [days, setDays] = useState("7");
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [link, setLink] = useState<OwnerShare | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function changed() {
    setPreview(null);
    setLink(null);
    setConfirmed(false);
  }
  async function prepare() {
    if (!q.data) return;
    const expires = Number(days);
    if (!Number.isInteger(expires) || expires < 1 || expires > 30) {
      setError("Choose link validity from 1 to 30 days.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setPreview(
        await api.previewShare(
          kind,
          id,
          q.data.revision,
          {
            title: title.trim() || undefined,
            display_name: name.trim() || undefined,
            include_source_url: source,
            allow_incomplete: incomplete,
            expires_in_days: expires,
          },
          q.data.generation
        )
      );
      setConfirmed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!preview || !confirmed) return;
    setBusy(true);
    try {
      setLink(await api.confirmShare(preview));
    } catch (e) {
      setError((e as Error).message);
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
  const website = process.env.EXPO_PUBLIC_WORKOUTS_WEBSITE_URL;
  const url = link ? sharingURL(link, website) : "";
  return (
    <Screen back title="Share intentionally." subtitle="Preview exactly what someone with the link will see.">
      <Field
        label="Public title"
        optional
        value={title}
        onChange={(v) => {
          setTitle(v);
          changed();
        }}
        placeholder={kind === "program" ? "Shared training program" : q.data?.title}
      />
      <Field
        label="Shared by · display name"
        optional
        value={name}
        onChange={(v) => {
          setName(v);
          changed();
        }}
      />
      <Field
        label="Link validity · days"
        numeric
        value={days}
        onChange={(v) => {
          setDays(v);
          changed();
        }}
      />
      <Choice
        label="Include original source link"
        selected={source}
        onPress={() => {
          setSource(!source);
          changed();
        }}
      />
      <Choice
        label="Allow sharing a template with missing details"
        selected={incomplete}
        onPress={() => {
          setIncomplete(!incomplete);
          changed();
        }}
      />
      <Button
        title="Preview public snapshot"
        busy={busy}
        disabled={!q.data || (kind === "program" && "status" in q.data && q.data.status !== "ready")}
        onPress={() => {
          void prepare();
        }}
      />
      {preview && (
        <>
          <SharedSnapshot snapshot={preview} />
          <Notice>
            The preview expires shortly. Anyone with the confirmed link can view this snapshot until it expires or you
            revoke it.
          </Notice>
          <Choice
            label="I reviewed this exact public snapshot"
            selected={confirmed}
            onPress={() => setConfirmed(!confirmed)}
          />
          <Button
            title="Create sharing link"
            busy={busy}
            disabled={!confirmed}
            onPress={() => {
              void publish();
            }}
          />
        </>
      )}
      {link && (
        <>
          {link.revoked_at ? (
            <Notice>This link is revoked. Deliberate copies already made by recipients remain independent.</Notice>
          ) : (
            <>
              <Copy>{url}</Copy>
              {!website && (
                <Notice>
                  This build uses an installed-app link. Web sharing requires the configured marketing website.
                </Notice>
              )}
              <Button
                title="Share this link"
                onPress={() => {
                  void Share.share({ message: url }).catch(() => setError("Could not open sharing."));
                }}
              />
              <Button
                title="Revoke this link"
                secondary
                busy={busy}
                onPress={() => {
                  void revoke();
                }}
              />
              <Notice>
                Revoking stops future reads and copies. It cannot remove independent copies a recipient deliberately
                saved.
              </Notice>
            </>
          )}
        </>
      )}
      {!!(error || q.error) && <Notice error>{error || q.error?.message}</Notice>}
    </Screen>
  );
}
