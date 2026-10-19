import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { Button, Empty, Loading, Notice, Screen } from "./ui";
export function AccountGate({ children }: { children: React.ReactNode }) {
  const b = useBaby();
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
      </Screen>
    );
  return children;
}
