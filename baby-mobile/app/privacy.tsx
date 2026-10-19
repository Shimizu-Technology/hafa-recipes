import { Button, Card, Copy, Screen, Section } from "@/components/ui";
import { router } from "expo-router";
export default function Privacy() {
  return (
    <Screen title="Your space stays personal." subtitle="Privacy & processing in Håfa Baby" back>
      <Section title="Your information">
        <Copy>
          Håfa Baby stores the profiles, care entries, journal writing, sources, files, routines, and conversations you
          choose to save. Each account has its own private information. A baby profile is part of the parent’s account
          and has no login.
        </Copy>
        <Copy>Using the same Håfa account does not connect your Recipes or Workouts history to Baby’s assistant.</Copy>
      </Section>
      <Section title="Optional AI">
        <Copy>
          AI is off until you give explicit permission. When you request it, OpenAI processes selected source text,
          images, audio or sampled video frames to organize sources. Questions can include relevant Baby records and
          recent conversation context. Turn permission off in Settings to stop new AI requests.
        </Copy>
        <Copy>
          Saved summaries and conversations remain until you delete them. AI may miss details or make mistakes. Original
          sources remain available, and proposed records are reviewed before saving. Imported advice does not activate
          reminders.
        </Copy>
      </Section>
      <Section title="On this device">
        <Copy>
          Native private drafts, cached records, and queued changes use AES-GCM encryption with a device-only key
          protected by Keychain/Keystore. Recent saved records are cached for offline access; your unsynced entries and
          drafts are kept until you save or discard them. Selected files are copied into the app’s device-protected
          private container. They are cleared for this account when you sign out. Web previews keep private drafts only
          in memory.
        </Copy>
        <Copy>
          Your phone’s lock and security settings also matter. Sharing or exporting creates a copy outside Håfa Baby
          that you control. Reminder notifications use general wording rather than journal or care details.
        </Copy>
      </Section>
      <Section title="Control & deletion">
        <Copy>
          You can edit or delete records, export your saved Baby data, withdraw AI permission, and delete the whole Baby
          space from Settings. Deleting Baby data leaves Recipes, Workouts, and your login intact. Deleting the entire
          Håfa account removes information across the Håfa apps.
        </Copy>
      </Section>
      <Card tone="soft">
        <Copy kind="heading">Care decisions stay with you and your clinician.</Copy>
        <Copy>
          This is a tool for organizing information and personal observations. Saved creator advice, your own notes, and
          clinician-entered instructions are different sources. The assistant is not a clinician or an emergency
          service.
        </Copy>
      </Card>
      <Button
        secondary
        title="Go back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/sign-in"))}
      />
    </Screen>
  );
}
