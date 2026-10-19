import { useState } from "react";
import { Alert, Linking } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { useBaby } from "@/lib/context";
import { messageFor } from "@/lib/models";
import { exportFile } from "@/lib/files";
import { Button, Card, Choice, Copy, Field, Notice, Row, Screen, Section, useToast } from "@/components/ui";
export default function Settings() {
  const b = useBaby(),
    toast = useToast(),
    profile = b.state.bootstrap!.profile,
    [name, setName] = useState(profile.display_name),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }
  async function consent(value: boolean) {
    await run(async () => {
      const result = await b.api.profile({ ...profile, ai_consent: value }, b.state.bootstrap!.generation);
      await b.commit((s) => ({ ...s, bootstrap: { ...s.bootstrap!, profile: result } }));
      toast(value ? "AI processing enabled." : "AI permission removed.");
    });
  }
  return (
    <Screen title="Make it yours." subtitle="A private space, with choices you control." back>
      {!!error && <Notice error>{error}</Notice>}
      <Section title="Your details">
        <Field label="Your name" value={name} onChange={setName} />
        <Button
          secondary
          title="Save name"
          busy={busy}
          onPress={() =>
            void run(async () => {
              const result = await b.api.profile(
                { ...profile, display_name: name.trim(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
                b.state.bootstrap!.generation
              );
              await b.commit((s) => ({ ...s, bootstrap: { ...s.bootstrap!, profile: result } }));
              toast("Your details are saved.");
            })
          }
        />
        <Copy kind="small" tone="muted">
          Time zone: {profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
        </Copy>
      </Section>
      <Section title="Your little ones">
        {b.state.bootstrap!.children.map((child) => (
          <Row
            key={child.id}
            title={child.name}
            detail={
              child.birth_date
                ? "Born " + child.birth_date
                : child.due_date
                  ? "Due " + child.due_date
                  : "Name, dates, and profile"
            }
            icon="person-outline"
            onPress={() => router.push({ pathname: "/child", params: { id: child.id } })}
          />
        ))}
        <Button secondary title="Add a baby profile" icon="add" onPress={() => router.push("/child")} />
      </Section>
      <Card tone="soft">
        <Copy kind="heading">Optional AI processing</Copy>
        <Copy>
          When you request processing, OpenAI receives the selected source text, images, audio or sampled video frames.
          When you ask a question, OpenAI receives your question, relevant authorized Baby records, and recent
          conversation context.
        </Copy>
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
                "OpenAI will process the sources and personal context described here when you use imports or Ask. You can turn this off at any time.",
                [
                  { text: "Keep off", style: "cancel" },
                  { text: "Allow processing", onPress: () => void consent(true) },
                ]
              );
          }}
        />
        <Button variant="ghost" title="Read privacy details" onPress={() => router.push("/privacy")} />
      </Card>
      <Section title="Your device">
        <Row
          title="Saved changes & recovery"
          detail={`${b.state.outbox.length} pending changes · ${b.online ? "Online" : "Offline"}`}
          icon="cloud-upload-outline"
          onPress={() => router.push("/sync")}
        />
        <Button
          secondary
          title="Open notification settings"
          icon="notifications-outline"
          onPress={() =>
            void Linking.openSettings().catch(() =>
              setError("Open your phone’s Settings to change notification permissions.")
            )
          }
        />
        <Copy kind="small" tone="muted">
          Private drafts and offline entries are stored with device-protected storage. Signing out clears this account’s
          local files and reminders. Unsynced work should be synced or exported first.
        </Copy>
      </Section>
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
        <Button
          variant="ghost"
          title="Delete my Baby data"
          onPress={() =>
            Alert.alert(
              "Delete all Baby information?",
              "This permanently removes your Baby records, files, conversations, and profiles. Recipes, Workouts, and your Håfa login remain. Older offline changes will not restore deleted data. Export anything you need first.",
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
            )
          }
        />
        <Button
          variant="ghost"
          title="Delete my entire Håfa account"
          onPress={() =>
            Alert.alert(
              "Delete your entire Håfa account?",
              "This also deletes your Recipes and Workouts information. This is permanent. Export anything you need first.",
              [
                { text: "Keep account", style: "cancel" },
                {
                  text: "Delete entire account",
                  style: "destructive",
                  onPress: () =>
                    Alert.alert(
                      "Confirm permanent account deletion",
                      "This affects every Håfa app linked to this account.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Permanently delete account",
                          style: "destructive",
                          onPress: () =>
                            void run(async () => {
                              await b.api.deleteAccount();
                              await b.signOut();
                            }),
                        },
                      ]
                    ),
                },
              ]
            )
          }
        />
      </Section>
      <Button
        secondary
        title="Sign out"
        busy={busy}
        onPress={() => {
          if (b.state.outbox.length)
            Alert.alert(
              "You have changes on this device",
              "Signing out removes unsynced entries and drafts from this device. Sync first to keep them in your account.",
              [
                { text: "Keep working", style: "cancel" },
                { text: "Sync changes", onPress: () => void b.sync() },
                { text: "Sign out and clear device", style: "destructive", onPress: () => void run(b.signOut) },
              ]
            );
          else void run(b.signOut);
        }}
      />
      <Copy align="center" kind="small" tone="muted">
        Håfa Baby · {Constants.expoConfig?.version ?? "1.0.0"}
        {Constants.nativeBuildVersion ? " (" + Constants.nativeBuildVersion + ")" : ""}
        {"\n"}Created for Kami and our growing family.
      </Copy>
    </Screen>
  );
}
