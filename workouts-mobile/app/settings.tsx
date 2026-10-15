import { useRef, useState } from "react";
import { useAuth, useClerk } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, Copy, ListGroup, ListRow, Notice, Screen, SectionHeader } from "@/components/ui";
import { suspendNativeSharing } from "@/lib/native-share-session";
import { useTraining } from "@/lib/context";
import { configuration } from "@/lib/config";
import { logoutBinding } from "@/lib/logout-recovery";

export default function Settings() {
  const clerk = useClerk();
  const { sessionId, userId } = useAuth();
  const { owner } = useTraining();
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signingOut = useRef(false);
  async function signOut() {
    if (signingOut.current) return;
    if (!sessionId || !userId) { setError("Your sign-in session is still loading. Try signing out again."); return; }
    const originalSession = sessionId;
    const originalBinding = logoutBinding(configuration.clerkEnvironment, configuration.clerkKey, userId);
    signingOut.current = true;
    setBusy(true);
    setError("");
    const sharing = suspendNativeSharing();
    try {
      await sharing.clear;
      await clerk.signOut({ sessionId: originalSession });
      // Clear cached account data only once sign-out succeeded; a failed attempt keeps the screen usable.
      cache.removeQueries({ predicate: query => query.queryKey[0] === owner ||
        (query.queryKey[0] === "identity" && query.queryKey[1] === originalBinding) });
    } catch {
      sharing.resume();
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
        <ListRow title="Safety Center" icon="shield-checkmark-outline" detail="Manage blocked contributors" onPress={() => router.push("/safety")} />
        <ListRow title="Manage sharing links" icon="link-outline" onPress={() => router.push("/sharing-links")} />
        <ListRow title="Account data and deletion" icon="shield-outline" onPress={() => router.push("/account-data")} />
      </ListGroup>
      {!!error && <Notice error>{error}</Notice>}
      <Button title="Sign out" variant="destructive" icon="log-out-outline" busy={busy} onPress={() => { void signOut(); }} />
      <Copy kind="small" tone="muted">Your private drafts stay on this device for this account. Signing in to another account does not load them.</Copy>
    </Screen>
  );
}
