import { useEffect, useState } from "react";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Notice, Screen } from "@/components/ui";
import { useTraining } from "@/lib/context";
import { useNativeHealth } from "@/lib/use-health";
import type { HealthObservation } from "@/lib/health/types";
import type { HealthChoices } from "@/lib/health-client";
const none: HealthChoices = {
  connected: false,
  read_on_device: false,
  upload_to_server: false,
  use_for_ai: false,
  write_actuals: false,
};
export default function Connections() {
  const { api, owner, enrollment } = useTraining();
  const health = useNativeHealth();
  const cache = useQueryClient();
  const caps = useQuery({
    queryKey: [owner, "capabilities", enrollment?.generation],
    queryFn: api.capabilities,
    enabled: !!enrollment?.enrolled,
  });
  const q = useQuery({
    queryKey: [owner, "health-connection", health.name, enrollment?.generation],
    queryFn: () => api.healthConnection(health.name),
    enabled: !!enrollment?.enrolled && !!caps.data?.health_sync,
  });
  const ai = useQuery({
    queryKey: [owner, "ai-consent", enrollment?.generation],
    queryFn: api.aiConsent,
    enabled: !!enrollment?.enrolled,
  });
  const [choices, setChoices] = useState<HealthChoices>(none);
  const [fenced, setFenced] = useState(false);
  const [observations, setObservations] = useState<HealthObservation[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (q.data)
      setChoices({
        connected: q.data.connected,
        read_on_device: q.data.read_on_device,
        upload_to_server: q.data.upload_to_server,
        use_for_ai: q.data.use_for_ai,
        write_actuals: q.data.write_actuals,
      });
  }, [q.data]);
  useEffect(() => {
    if (health.client) void health.client.isDisconnectedLocally().then(setFenced);
  }, [health.client, q.data]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish this health action.");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!health.client || !q.data) return;
    if (choices.use_for_ai && !ai.data?.accepted) {
      setError("Review and accept the separate AI disclosure before permitting eligible health context.");
      return;
    }
    await run(async () => {
      const permission = await health.requestAccess(choices.read_on_device, choices.write_actuals);
      const saved = await health.client!.saveChoices(
        { ...choices, connected: choices.read_on_device || choices.write_actuals },
        q.data!.revision
      );
      cache.setQueryData([owner, "health-connection", health.name, enrollment?.generation], saved);
      setFenced(false);
      setMessage(permission.message);
      await q.refetch();
    });
  }
  async function refresh() {
    if (!health.client) return;
    await run(async () => {
      if (q.data?.upload_to_server) {
        const result = await health.client!.refresh();
        setObservations(await api.healthObservations(health.name));
        setMessage(
          [
            result.has_more ? "More activity is available. Refresh again to continue." : "Refresh finished.",
            ...result.coverage_notes,
          ].join(" ")
        );
      } else {
        const page = await health.client!.readOnDevice();
        setObservations(page.observations);
        setMessage(
          page.has_more
            ? "Showing the first available page on this device. Server storage is off."
            : "No upload was sent. These summaries are only shown on this device."
        );
      }
      await q.refetch();
    });
  }
  async function disconnect() {
    if (!health.client) return;
    setFenced(true);
    setObservations([]);
    await run(async () => {
      await health.client!.disconnect(q.data!.revision);
      await q.refetch();
      setMessage(
        "Disconnected. New reads, uploads and write-back are blocked; imported server projections were removed. Records originally created by other apps stay in Health."
      );
    });
  }
  async function retryDisconnect() {
    if (!health.client) return;
    await run(async () => {
      await health.client!.retryDisconnect();
      await q.refetch();
      setMessage("Server disconnection is acknowledged. Local access remains off.");
    });
  }
  return (
    <Screen
      back
      title="Connect on your terms."
      subtitle="Health data stays separate from Recipes, and every use has its own choice."
    >
      <Button title="Read health access explanation" secondary onPress={() => router.push("/health-rationale")} />
      <Button title="AI sharing preferences" secondary onPress={() => router.push("/ai-preferences")} />
      <Card>
        <Copy kind="heading">{health.name === "apple_health" ? "Apple Health" : "Health Connect"}</Copy>
        <Copy>{health.availability?.message ?? "Checking this native build…"}</Copy>
        {caps.data && !caps.data.health_sync && (
          <Notice>
            Health server features are not enabled for this build. Your manual training remains available.
          </Notice>
        )}
        {q.error && <Notice error>{q.error.message}</Notice>}
        <Choice
          label="Read workout summaries on this device"
          selected={choices.read_on_device}
          onPress={() =>
            setChoices((c) => ({
              ...c,
              read_on_device: !c.read_on_device,
              ...(c.read_on_device ? { upload_to_server: false, use_for_ai: false } : {}),
            }))
          }
        />
        <Choice
          label="Store these summaries in my Håfa account"
          detail="A separate choice from reading on this device."
          selected={choices.upload_to_server}
          onPress={() => {
            if (!choices.read_on_device) {
              setError("Choose on-device reading first.");
              return;
            }
            setChoices((c) => ({
              ...c,
              upload_to_server: !c.upload_to_server,
              ...(c.upload_to_server ? { use_for_ai: false } : {}),
            }));
          }}
        />
        <Choice
          label="Allow eligible activity in AI coaching"
          detail="Requires server storage and the separate AI disclosure."
          selected={choices.use_for_ai}
          onPress={() => {
            if (!choices.upload_to_server) {
              setError("Choose server storage first if you want eligible activity to be available to coaching.");
              return;
            }
            setChoices((c) => ({ ...c, use_for_ai: !c.use_for_ai }));
          }}
        />
        <Notice>
          Third-party activity currently stays out of AI context while source permissions are reviewed. Restricted
          sources stay excluded even when you opt in.
        </Notice>
        <Choice
          label="Write my actual completed Håfa sessions to Health"
          detail="No invented calories, heart rate or distance. Paused intervals that cannot be represented stay in the app."
          selected={choices.write_actuals}
          onPress={() => setChoices((c) => ({ ...c, write_actuals: !c.write_actuals }))}
        />
        <Button
          title={q.data?.connected ? "Save health choices" : "Connect with these choices"}
          busy={busy}
          disabled={!q.data || health.availability?.status !== "available"}
          onPress={() => {
            void save();
          }}
        />
        {health.access && (
          <Notice>
            {health.access.message}
            {health.access.read === "denied" ? " Reading is not permitted by the device." : ""}
            {health.access.write === "denied" ? " Writing is not permitted by the device." : ""}
          </Notice>
        )}
        {!!q.data?.last_sync_at && <Copy>Last server sync · {new Date(q.data.last_sync_at).toLocaleString()}</Copy>}
        {q.data?.connected && !fenced && (
          <Button
            title={q.data.upload_to_server ? "Refresh and store activity" : "Read on this device only"}
            secondary
            busy={busy}
            disabled={!q.data.read_on_device}
            onPress={() => {
              void refresh();
            }}
          />
        )}
        <Button
          title="Manage system health permissions"
          secondary
          disabled={!health.provider || health.availability?.status !== "available"}
          onPress={() => {
            void run(() => health.provider!.openSettings());
          }}
        />
        {q.data?.connected && (
          <Button
            title="Disconnect health access"
            secondary
            onPress={() => {
              void disconnect();
            }}
          />
        )}
        {fenced && (
          <>
            <Notice>
              Health access is blocked on this device. If the server could not be reached, retry its disconnection
              before reconnecting.
            </Notice>
            <Button
              title="Retry server disconnection"
              secondary
              disabled={busy}
              onPress={() => {
                void retryDisconnect();
              }}
            />
          </>
        )}
      </Card>
      {!!message && <Notice>{message}</Notice>}
      {!!error && <Notice error>{error}</Notice>}
      {!!observations.length && (
        <>
          <Copy kind="heading">Available activity summaries</Copy>
          <Notice>
            These are source records. Overlapping entries are not automatically summed as separate workouts.
          </Notice>
          {observations.map((record) => (
            <Card key={record.source_id}>
              <Copy>{new Date(record.started_at).toLocaleString()}</Copy>
              <Copy>
                {Math.round(record.duration_seconds / 60)} minutes ·{" "}
                {record.duration_basis === "elapsed_interval" ? "source interval" : "provider-reported duration"}
              </Copy>
              <Copy>
                {record.origin_id.toLowerCase().includes("strava") ? "Strava source" : "Connected exercise source"}
              </Copy>
              {!!record.possible_duplicate_of?.length && (
                <Notice>Possible overlapping activity: review before combining totals.</Notice>
              )}
            </Card>
          ))}
        </>
      )}
      <Button title="Håfa app connections" secondary onPress={() => router.push("/hafa-apps")} />
    </Screen>
  );
}
