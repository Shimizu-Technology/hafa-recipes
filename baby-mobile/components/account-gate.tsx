import { Alert } from "react-native";
import { useState } from "react";
import { revokeShareSession } from "@/lib/share-session-state";
import { useBaby } from "@/lib/context";
import { confirmAccountDeletion } from "@/lib/account-deletion";
import { messageFor } from "@/lib/models";
import { deviceWorkCount } from "@/lib/outbox";
import { Button, Empty, Loading, Notice, Screen } from "./ui";
export function AccountGate({ children }: { children: React.ReactNode }) {
  const b = useBaby(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function deleteAccount() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await revokeShareSession();
      await b.api.deleteAccount();
      await b.signOut();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }
  if (!b.ready || !b.state.bootstrap)
    return (
      <Screen title="A little room to remember">
        <Loading />
        {!!b.error && <Notice error>{b.error}</Notice>}
        <Button title="Try again" secondary onPress={() => void b.refresh()} />
        <Button title="Sign out" variant="ghost" onPress={() => {
          // What needs recovery is still on this phone, and a sign-out clears it.
          // A failed vault read cannot tell us whether this phone has queued work. Never clear it without warning.
          if (!b.error && !deviceWorkCount(b.state)) return void b.signOut();
          Alert.alert("Sign out and clear this phone?", "Changes that haven’t sent are saved here, and signing out removes them. Update Håfa Baby first if you can: that usually opens them again.", [
            { text: "Keep them", style: "cancel" },
            { text: "Sign out and clear", style: "destructive", onPress: () => void b.signOut() },
          ]);
        }} />
      </Screen>
    );
  if (b.state.bootstrap.active === false)
    return (
      <Screen title="Your space is cleared">
        <Empty
          title="Start fresh when you’re ready"
          body="Your previous Baby data was removed. Older offline changes will not be uploaded."
          action={<Button title="Start a new Baby space" onPress={() => void b.enroll()} />}
        />
        <Button secondary title="Sign out" onPress={() => void b.signOut()} />
        {!!error && <Notice error>{error}</Notice>}
        <Button
          title="Delete my entire Håfa account"
          variant="ghost"
          busy={busy}
          onPress={() => confirmAccountDeletion(() => void deleteAccount())}
        />
      </Screen>
    );
  return children;
}
