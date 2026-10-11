import { useRef, useState } from "react";
import { useClerk } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, Card, Copy, Notice, Screen } from "@/components/ui";

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
      <Card>
        <Copy kind="heading">Your training</Copy>
        <Button title="Edit training profile" secondary icon="person-outline" onPress={() => router.push("/profile")} />
        <Button title="Measurement history" secondary icon="analytics-outline" onPress={() => router.push("/measurements")} />
        <Button title="Reminders and rest alerts" secondary icon="notifications-outline" onPress={() => router.push("/reminders")} />
      </Card>
      <Card>
        <Copy kind="heading">Connections</Copy>
        <Copy>Health access, AI use, and Recipes connections each have their own choices.</Copy>
        <Button title="Health connections" secondary icon="heart-outline" onPress={() => router.push("/connections")} />
        <Button title="AI sharing preferences" secondary onPress={() => router.push("/ai-preferences")} />
        <Button title="Håfa apps" secondary icon="apps-outline" onPress={() => router.push("/hafa-apps")} />
      </Card>
      <Card>
        <Copy kind="heading">Privacy and saved data</Copy>
        <Button title="Manage sharing links" secondary onPress={() => router.push("/sharing-links")} />
        <Button title="Account data and deletion" secondary onPress={() => router.push("/account-data")} />
      </Card>
      {!!error && <Notice error>{error}</Notice>}
      <Button title="Sign out" secondary busy={busy} onPress={() => { void signOut(); }} />
      <Copy kind="small">Your private drafts stay on this device for this account. Signing in to another account does not load them.</Copy>
    </Screen>
  );
}
