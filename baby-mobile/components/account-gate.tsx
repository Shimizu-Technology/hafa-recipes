import { useState } from "react";
import { revokeShareSession } from "@/lib/share-session-state";
import { useBaby } from "@/lib/context";
import { confirmAccountDeletion } from "@/lib/account-deletion";
import { messageFor } from "@/lib/models";
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
        <Button title="Sign out" variant="ghost" onPress={() => void b.signOut()} />
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
