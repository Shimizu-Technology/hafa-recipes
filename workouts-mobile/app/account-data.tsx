import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Notice, Screen } from "@/components/ui";
import { useTraining } from "@/lib/context";
import { useReminders } from "@/components/reminders-provider";
import { collectSnapshotExport } from "@/lib/account";
import { savePrivateExport } from "@/lib/export-file";
import { logoutBinding, clearLogoutQueries } from "@/lib/logout-recovery";
import { logoutRecovery } from "@/lib/logout-recovery-native";
import { configuration } from "@/lib/config";
export default function AccountData() {
  const { api, owner, enrollment, storage, eraseLocalData, invalidateAccount } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const currentEnrollment = useRef(enrollment);
  currentEnrollment.current = enrollment;
  const { userId, sessionId } = useAuth();
  const cache = useQueryClient();
  const reminders = useReminders();
  const [mode, setMode] = useState<"none" | "workouts" | "account">("none");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingCleanup, setPendingCleanup] = useState<"workouts" | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );
  async function exportData() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    let snapshotId: string | null = null;
    let cleanupWarning = "";
    try {
      const guard = () => {
        if (
          !mounted.current ||
          !storage.isCurrent() ||
          !currentEnrollment.current?.enrolled ||
          currentEnrollment.current.generation !== generation
        )
          throw Error("Export was cancelled because training enrollment changed.");
      };
      guard();
      const manifest = await api.createExportSnapshot(generation);
      snapshotId = manifest.id;
      guard();
      const data = await collectSnapshotExport(
        manifest,
        (page) => api.exportSnapshotPage(manifest.id, page, generation),
        guard
      );
      await savePrivateExport(data, owner, guard);
      setMessage(
        "The export file was opened for saving. Keep it somewhere private; it contains your saved training and health-related records."
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (snapshotId) {
        try {
          await api.deleteExportSnapshot(snapshotId, generation);
        } catch {
          cleanupWarning =
            "The private server snapshot cleanup was not acknowledged. It expires automatically within10minutes.";
        }
      }
      if (cleanupWarning && mounted.current) setMessage((current) => `${current} ${cleanupWarning}`);
      lock.current = false;
      setBusy(false);
    }
  }
  async function finishCleanup() {
    const failures: string[] = [];
    try {
      await reminders.controller?.cleanupOwned();
    } catch {
      failures.push("Device reminders still need cleanup.");
    }
    try {
      await eraseLocalData();
    } catch {
      failures.push("Private drafts or temporary files still need cleanup.");
    }
    if (failures.length)
      throw Error(
        `Server data was already erased. ${failures.join(" ")} Retry device cleanup; do not repeat account deletion.`
      );
    setPendingCleanup(null);
    setMessage(
      "Workouts data was removed. Your Håfa login and Recipes data remain available. Old queued training is retired."
    );
    setMode("none");
    setConfirmed(false);
  }
  async function remove() {
    if (lock.current || (!pendingCleanup && (!confirmed || mode === "none"))) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (pendingCleanup) {
        await finishCleanup();
        return;
      }
      await eraseLocalData();
      setMessage(
        "Private drafts and reminders were removed from this device. Requesting the chosen server deletion now…"
      );
      if (mode === "workouts") {
        const tombstone = await api.removeWorkoutsData(generation);
        cache.removeQueries({ predicate: (q) => q.queryKey[0] === owner && q.queryKey[1] !== "enrollment" });
        cache.setQueryData([owner, "enrollment"], tombstone);
        setPendingCleanup("workouts");
        await finishCleanup();
      } else {
        if (!userId || !sessionId) throw Error("Verify your current sign-in before deleting the account.");
        const acknowledgement = { version: 1 as const, owner, subject: userId, sessionId,
          binding: logoutBinding(configuration.clerkEnvironment, configuration.clerkKey, userId) };
        const result = await api.deleteHafaAccount();
        await logoutRecovery.acknowledge(acknowledgement, (record) => clearLogoutQueries(cache, record));
        invalidateAccount();
        if (mounted.current) setMessage(`${result.message}. Finishing device cleanup and sign-out…`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen
      back
      title="Your account. Your data."
      subtitle="Choose the scope carefully. Workouts and Recipes share the same Håfa sign-in."
    >
      <Card>
        <Copy kind="heading">Export saved Workouts records</Copy>
        <Copy>
          This JSON includes server-saved library, plans, completed training, profile, permissions and available health
          projections. Device-only drafts and original records in Apple Health or Health Connect are separate. One
          captured private snapshot keeps all pages consistent. Privacy removal or permission revocation cancels the
          snapshot; start a fresh export if that happens.
        </Copy>
        <Button
          title="Export private Workouts JSON"
          secondary
          disabled={!enrollment?.enrolled}
          busy={busy}
          onPress={() => {
            void exportData();
          }}
        />
      </Card>
      <Card>
        <Copy kind="heading">Remove only Workouts data</Copy>
        <Copy>
          Erases local private drafts, pending commands and reminders first, then requests deletion of saved training.
          If the connection fails, device drafts remain erased and you can retry saved-data deletion. Your Håfa login
          and Recipes data stay available. Public Workouts sharing links stop working. Existing copies saved by other
          people stay theirs. Content-free import allowance records remain for up to 48 hours to protect the shared beta;
          they contain no source text, images or workout content.
        </Copy>
        <Button
          title="Review Workouts-only removal"
          secondary
          disabled={!enrollment?.enrolled || busy || !!pendingCleanup}
          onPress={() => {
            setMode("workouts");
            setConfirmed(false);
          }}
        />
      </Card>
      <Card>
        <Copy kind="heading">Delete the whole Håfa account</Copy>
        <Copy>
          Erases local Workouts drafts first, then requests deletion of your data in both Workouts and Recipes and signs
          you out. Whole-account deletion also clears the remaining content-free import allowance records. External login and uploaded-file cleanup may continue after server data is erased. Previously
          distributed copies remain independent.
        </Copy>
        <Button
          title="Review whole-account deletion"
          secondary
          disabled={busy || !!pendingCleanup}
          onPress={() => {
            setMode("account");
            setConfirmed(false);
          }}
        />
      </Card>
      <Notice>
        Removing app data does not erase workout records already written to Apple Health or Health Connect. Manage those
        records in your device's Health app.
      </Notice>
      {pendingCleanup && (
        <Button
          title="Retry device cleanup"
          busy={busy}
          onPress={() => {
            void remove();
          }}
        />
      )}
      {mode !== "none" && !pendingCleanup && (
        <Card>
          <Copy kind="heading">
            {mode === "workouts" ? "Confirm Workouts-only removal" : "Confirm deletion of both Håfa apps"}
          </Copy>
          <Choice
            label={
              mode === "workouts"
                ? "I understand my saved training and device drafts will be erased."
                : "I understand my Recipes and Workouts data will both be erased."
            }
            selected={confirmed}
            disabled={busy}
            onPress={() => setConfirmed(!confirmed)}
          />
          <Button
            title={mode === "workouts" ? "Erase my Workouts data" : "Delete my whole Håfa account"}
            disabled={!confirmed}
            busy={busy}
            onPress={() => {
              void remove();
            }}
          />
          <Button
            title="Keep my data"
            secondary
            disabled={busy}
            onPress={() => {
              setMode("none");
              setConfirmed(false);
            }}
          />
        </Card>
      )}
      {!!message && <Notice>{message}</Notice>}
      {!!error && <Notice error>{error}</Notice>}
    </Screen>
  );
}
