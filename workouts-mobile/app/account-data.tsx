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
import { useExportJob } from "@/lib/use-export-job";
import { exportJobDescription, terminalExport } from "@/lib/export-jobs";
export default function AccountData() {
  const { api, owner, enrollment, storage, eraseLocalData, invalidateAccount } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const currentEnrollment = useRef(enrollment);
  currentEnrollment.current = enrollment;
  const { userId, sessionId } = useAuth();
  const exports = useExportJob(logoutBinding(configuration.clerkEnvironment, configuration.clerkKey, userId ?? ""));
  const exportView = exports.view;
  const cache = useQueryClient();
  const reminders = useReminders();
  const [mode, setMode] = useState<"none" | "workouts" | "account">("none");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const exportBusy = busy || exportView.busy;
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
    if (lock.current || exportView.busy || (!pendingCleanup && (!confirmed || mode === "none"))) return;
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
        {!enrollment?.enrolled ? <Notice>Set up your Workouts account before exporting saved server records.</Notice> : exports.useJobs ? <>
          {exportView.job && <Notice>{exportJobDescription(exportView.job, exportView.command?.cancel_requested)}</Notice>}
          {exportView.phase === "uncertain" && <Notice>
            This device retained the original export request. Check it or retry that same request; preparation may already have started.
          </Notice>}
          {exportView.command?.cancel_requested && !exportView.command.job_id && <Notice>
            Cancellation has no acknowledged server handle yet. Resolving the original request may briefly admit that same request before immediately cancelling it. It never creates a fresh request.
          </Notice>}
          {exportView.phase === "downloading" && <Notice>
            Downloading private pages: {exportView.pages} of {exportView.job?.manifest?.page_count ?? 0}. Only a complete file can be opened.
          </Notice>}
          {exportView.phase === "saving" && <Notice>Opening your device’s save options. Temporary records will be cleaned afterward.</Notice>}
          {!exportView.command && <Button title="Prepare private Workouts export" secondary
            disabled={!exports.enabled || exportBusy || exportView.phase === "loading"}
            busy={exportView.busy} onPress={() => { void exports.controller?.start(); }} />}
          {exportView.job?.status === "ready" && !exportView.command?.cancel_requested && !exportView.invalidated &&
            <Button title={exportView.error ? "Retry download and save" : "Save complete private export"}
              disabled={!exports.enabled || busy} busy={exportView.busy} onPress={() => { void exports.controller?.save(); }} />}
          {exportView.command && <Button title="Check this export" secondary
            disabled={!exports.enabled || exportBusy} onPress={exports.check} />}
          {exportView.command && !exportView.command.job_id &&
            <Button title={exportView.command.cancel_requested ? "Resolve original request and cancel" : "Retry original preparation request"} secondary disabled={!exports.enabled || exportBusy}
              onPress={() => { void exports.controller?.retryAdmission(); }} />}
          {exportView.command && (!exportView.job || !terminalExport(exportView.job) || exportView.job.cleanup_pending) &&
            <Button title={exportView.command.cancel_requested || exportView.job?.cleanup_pending ? "Retry cancellation and cleanup" : "Cancel and discard this export"}
              secondary disabled={!exports.enabled || exportBusy} onPress={() => { void exports.controller?.cancel(); }} />}
          {exportView.job && terminalExport(exportView.job) && !exportView.job.cleanup_pending &&
            <Button title="Start a fresh private export" secondary disabled={!exports.enabled || exportBusy}
              onPress={() => { void exports.controller?.start(); }} />}
          {exports.pollStopped && <Notice>Automatic checking paused after a bounded check period. Check this same export deliberately when you return.</Notice>}
          {exports.pollStopped && exportView.phase === "loading" && <Button title="Check original export recovery" secondary
            disabled={!exports.enabled || exportBusy} onPress={() => { void exports.controller?.restore(); }} />}
          {!!exportView.message && <Notice>{exportView.message}</Notice>}
          {!!exportView.error && <Notice error>{exportView.error}</Notice>}
        </> : exports.knownLegacy ? <Button
          title="Export private Workouts JSON"
          secondary
          disabled={!enrollment?.enrolled}
          busy={busy}
          onPress={() => {
            void exportData();
          }}
        /> : <>
          {!!exportView.error && <Notice error>{exportView.error}</Notice>}
          <Notice>{exports.pollStopped && exportView.phase === "loading" ? "Original export recovery is paused. Check that same request before preparing anything else." : exports.capability.isError ? "Export availability could not be checked. No new export was started." : exportView.error ? "The original export recovery handle needs review before a new export can be started." : "Checking export availability…"}</Notice>
          {exports.capability.isError && <Button title="Retry export availability" secondary disabled={!exports.enabled || busy}
            onPress={() => { void exports.capability.refetch(); }} />}
          {!!exportView.error && <Button title="Retry export recovery" secondary disabled={!exports.enabled || exportBusy}
            onPress={() => { void exports.controller?.restore(); }} />}
          {exports.pollStopped && exportView.phase === "loading" && <>
            <Button title="Check original export recovery" secondary disabled={!exports.enabled || exportBusy}
              onPress={() => { void exports.controller?.restore(); }} />
          </>}
        </>}
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
          disabled={!enrollment?.enrolled || exportBusy || !!pendingCleanup}
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
          disabled={exportBusy || !!pendingCleanup}
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
            disabled={exportBusy}
            onPress={() => setConfirmed(!confirmed)}
          />
          <Button
            title={mode === "workouts" ? "Erase my Workouts data" : "Delete my whole Håfa account"}
            disabled={!confirmed || exportBusy}
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
