import { useRef, useState } from "react";
import { useClerk } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, Copy, ListGroup, ListRow, Notice, Screen, SectionHeader } from "@/components/ui";

export default function Settings() {
  const clerk = useClerk();
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signingOut = useRef(false);
  async function signOut() {
    if (signingOut.current) return;
    signingOut.current = true;
    setBusy(true);
    setError("");
    try {
      cache.clear();
      await clerk.signOut();
    } catch {
      setError("Could not sign out. Your private drafts remain saved for this account. Try again.");
    } finally {
      signingOut.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen back title="Your Håfa account." subtitle="One account. Your choices, in each app.">
      <SectionHeader title="Your training" />
      <ListGroup>
        <ListRow title="Edit training profile" icon="person-outline" onPress={() => router.push("/profile")} />
        <ListRow title="Measurement history" icon="analytics-outline" onPress={() => router.push("/measurements")} />
        <ListRow title="Reminders and rest alerts" icon="notifications-outline" onPress={() => router.push("/reminders")} />
      </ListGroup>
      <SectionHeader title="Connections" />
      <Copy kind="small" tone="muted">Health access, AI use, and Recipes connections each have their own choices.</Copy>
      <ListGroup>
        <ListRow title="Health connections" icon="heart-outline" onPress={() => router.push("/connections")} />
        <ListRow title="AI sharing preferences" icon="sparkles-outline" onPress={() => router.push("/ai-preferences")} />
        <ListRow title="Håfa apps" icon="apps-outline" detail="Recipes and Workouts, one account" onPress={() => router.push("/hafa-apps")} />
      </ListGroup>
      <SectionHeader title="Privacy and saved data" />
      <ListGroup>
        <ListRow title="Manage sharing links" icon="link-outline" onPress={() => router.push("/sharing-links")} />
        <ListRow title="Account data and deletion" icon="shield-outline" onPress={() => router.push("/account-data")} />
      </ListGroup>
      {!!error && <Notice error>{error}</Notice>}
      <Button title="Sign out" variant="destructive" icon="log-out-outline" busy={busy} onPress={() => { void signOut(); }} />
      <Copy kind="small" tone="muted">Your private drafts stay on this device for this account. Signing in to another account does not load them.</Copy>
    </Screen>
  );
}
