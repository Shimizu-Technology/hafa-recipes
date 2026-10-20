import { useEffect, useState } from "react";
import { Image } from "expo-image";
import { useBaby } from "@/lib/context";
import { messageFor, type Attachment } from "@/lib/models";
import { openAttachment } from "@/lib/files";
import { Button, Card, Copy, Loading, Notice } from "./ui";

/** Authorized images never enter a public URL or the shared image disk cache. */
export function PrivateAttachment({ id }: { id: string }) {
  const b = useBaby();
  const [metadata, setMetadata] = useState<Attachment>();
  const [token, setToken] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const lease = b.api.lease();
    setError("");
    setMetadata(undefined);
    setToken(undefined);
    void (async () => {
      try {
        const item = await b.api.attachment(id);
        const auth = await b.getToken();
        b.api.assertLease(lease);
        if (!active || !b.current()) return;
        if (!auth) throw Error("Sign in again to open this file.");
        setMetadata(item);
        setToken(auth);
      } catch (e) {
        if (active && b.current()) setError(messageFor(e));
      }
    })();
    return () => { active = false; };
  }, [id, b.api, b.owner, b.state.bootstrap?.generation, attempt]);
  async function open() {
    setBusy(true);
    setError("");
    try { await openAttachment(b.api, id, b.getToken, b.owner, b.current); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  }
  return <Card>
    {!metadata && !error && <Loading />}
    {metadata && <>
      {metadata.mime_type.startsWith("image/") && token && <Image
        accessibilityLabel={metadata.name}
        source={{ uri: b.api.attachmentUrl(id), headers: { Authorization: `Bearer ${token}` } }}
        cachePolicy="none" contentFit="contain"
        style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 14 }}
        onError={() => setError("This photo could not load. Try opening it again.")}
      />}
      <Copy kind="small">{metadata.name}</Copy>
      <Button secondary title={metadata.mime_type.startsWith("image/") ? "Open or share photo" : "Open " + metadata.name}
        icon="open-outline" busy={busy} onPress={() => void open()} />
    </>}
    {!!error && <><Notice error>{error}</Notice><Button secondary title="Try again" onPress={() => setAttempt(a => a + 1)} /></>}
  </Card>;
}
