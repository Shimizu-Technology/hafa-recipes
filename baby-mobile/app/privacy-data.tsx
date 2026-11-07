import { removedWarning, waitingShareCount, useWaitingShareCount } from "@/lib/waiting-shares";
import { recoverySummary } from "@/lib/outbox";
import { useEffect, useRef, useState } from "react";
import { Alert, ScrollView } from "react-native";
import { router } from "expo-router";
import { revokeShareSession } from "@/lib/share-session-state";
import { useBaby } from "@/lib/context";
import { ASK_CONSENT_BODY } from "@/lib/ai-consent";
import { messageFor } from "@/lib/models";
import { confirmAccountDeletion } from "@/lib/account-deletion";
import { exportFile } from "@/lib/files";
import { Button, Card, Choice, Copy, Notice, Row, Screen, Section, useToast } from "@/components/ui";
import { SettingsGroup } from "@/components/settings-group";

/** The settings that are seldom changed and hard to undo, a tap away from Settings. `/settings?section=ai` lands here, with AI first. */
export default function PrivacyData() {
  const b = useBaby(), waiting = useWaitingShareCount(),
    toast = useToast(),
    profile = b.state.bootstrap!.profile,
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    working = useRef(false),
    scroller = useRef<ScrollView>(null);
  // What went wrong shows at the top, and Export and Delete are far below it.
  useEffect(() => { if (error) scroller.current?.scrollTo({ y: 0 }); }, [error]);
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function consent(value: boolean) {
    await run(async () => {
      const version = b.state.bootstrap!.ask_consent_version;
      const result = await b.api.profile({ ai_consent: value,
        ...(!value ? { auto_process_shares: false } : version ? { acknowledge_ai_consent_version: version } : {}) }, b.state.bootstrap!.generation);
      await b.commit((s) => ({ ...s, bootstrap: { ...s.bootstrap!, profile: result } }));
      toast(value ? "AI processing enabled." : "AI permission removed.");
    });
  }
  return (
    <Screen scrollRef={scroller} title="Privacy & data" back>
      {!!error && <Notice error>{error}</Notice>}
      <Card tone="soft">
        <Copy kind="heading">Optional AI processing</Copy>
        {b.state.bootstrap!.ask_consent_version ? <Copy>{ASK_CONSENT_BODY}</Copy> : <Copy>
          When you request processing, OpenAI receives the selected source text, images, audio or sampled video frames.
          When you ask a question, OpenAI receives your question, relevant authorized Baby records, and recent
          conversation context.
        </Copy>}
        <Copy tone="muted">
          Recipes and Workouts data are not included. You can withdraw permission at any time. Previously processed
          results stay in your library until you delete them. Imported advice does not activate a care schedule.
        </Copy>
        <Choice
          label="Allow my selected Baby information to be processed by OpenAI"
          selected={profile.ai_consent}
          disabled={busy}
          onPress={() => {
            if (profile.ai_consent) void consent(false);
            else
              Alert.alert(
                "Allow optional AI processing?",
                b.state.bootstrap!.ask_consent_version ? ASK_CONSENT_BODY
                  : "OpenAI will process the sources and personal context described here when you use imports or Ask. You can turn this off at any time.",
                [
                  { text: "Keep off", style: "cancel" },
                  { text: "Allow processing", onPress: () => void consent(true) },
                ]
              );
          }}
        />
        <Button variant="ghost" title="Read privacy details" onPress={() => router.push("/privacy")} />
        <Choice label="Automatically organize posts I share" selected={profile.auto_process_shares === true}
          disabled={busy || !profile.ai_consent}
          detail={profile.ai_consent ? "New shared posts process automatically. Existing saved posts are kept as they are."
            : "Allow AI processing above to enable this. Saving originals always works."}
          onPress={() => {
            const save = () => void run(async () => {
              const enabled = !profile.auto_process_shares;
              const result = await b.api.profile({ auto_process_shares: enabled }, b.state.bootstrap!.generation);
              await b.commit((s) => ({ ...s, bootstrap: { ...s.bootstrap!, profile: result } }));
              // The API has the last word: permission may have been withdrawn on another phone.
              toast(result.auto_process_shares ? "Shared posts will process automatically." : "Automatic processing is off. Originals stay saved.");
            });
            if (profile.auto_process_shares) save();
            else Alert.alert("Automatically process shared posts?",
              "New posts you share with Baby will be sent to OpenAI for processing. You can keep browsing, and turn this off at any time.",
              [{ text: "Keep off", style: "cancel" }, { text: "Allow processing", onPress: save }]);
          }} />
      </Card>
      <SettingsGroup title="On this phone" note="Private drafts and offline entries are stored with device-protected storage. Signing out clears this account’s local files and reminders. Unsynced work should be synced or exported first.">
        <Row
          title="Saved changes & recovery"
          numericDetail
          detail={`${recoverySummary(b.state)}${waiting ? ` · ${waiting} ${waiting === 1 ? "share" : "shares"} waiting` : ""} · ${b.online ? "Online" : "Offline"}`}
          icon="cloud-upload-outline"
          onPress={() => router.push("/sync")}
        />
      </SettingsGroup>
      <Section title="Your information">
        <Button
          secondary
          title="Export my Baby data"
          icon="download-outline"
          busy={busy}
          onPress={() =>
            void run(async () => {
              const data = await b.api.export();
              await exportFile(data, b.owner);
            })
          }
        />
        <Copy kind="small" tone="muted">
          The export contains saved server records. Sync pending changes before exporting. Attachments remain separate
          private files.
        </Copy>
      </Section>
      <Section title="Delete">
        <Copy kind="small" tone="muted">
          These cannot be undone. Export anything you want to keep first.
        </Copy>
        <Button
          variant="destructive"
          title="Delete my Baby data"
          busy={busy}
          onPress={async () => {
            const waiting = await waitingShareCount();
            Alert.alert(
              "Delete all Baby information?",
              `This permanently removes your Baby records, files, conversations, and profiles. Recipes, Workouts, and your Håfa login remain. Older offline changes will not restore deleted data. Export anything you need first.${waiting ? ` ${removedWarning(waiting)}` : ""}`,
              [
                { text: "Keep my data", style: "cancel" },
                {
                  text: "Delete Baby data",
                  style: "destructive",
                  onPress: () =>
                    void run(async () => {
                      await b.erase();
                      toast("Your Baby space was cleared.");
                    }),
                },
              ]
            );
          }}
        />
        <Button
          variant="destructive"
          title="Delete my entire Håfa account"
          busy={busy}
          onPress={async () => {
            const waiting = await waitingShareCount();
            confirmAccountDeletion(() =>
              void run(async () => {
                await revokeShareSession();
                await b.api.deleteAccount();
                await b.signOut();
              }), waiting ? removedWarning(waiting) : undefined
            );
          }}
        />
      </Section>
    </Screen>
  );
}
