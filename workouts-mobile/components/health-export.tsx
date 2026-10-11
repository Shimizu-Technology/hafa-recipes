import { useState } from "react";
import { Button, Notice } from "./ui";
import { useNativeHealth } from "@/lib/use-health";
export function HealthExport({ sessionId }: { sessionId: string }) {
  const health = useNativeHealth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function write() {
    if (!health.client) return;
    setBusy(true);
    setError("");
    try {
      const result = await health.client.exportSession(sessionId);
      setMessage(
        result.status === "unsupported"
          ? (result.message ?? "This session cannot be exported truthfully. Its app record is preserved.")
          : result.status === "already_written"
            ? "This actual session was already written; no duplicate was created."
            : "The device reported this actual session written to Health."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete health write-back.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        title="Write actual session to Health"
        secondary
        busy={busy}
        disabled={!health.client || health.availability?.status !== "available"}
        onPress={() => {
          void write();
        }}
      />
      {!!message && <Notice>{message}</Notice>}
      {!!error && <Notice error>{error}</Notice>}
    </>
  );
}
