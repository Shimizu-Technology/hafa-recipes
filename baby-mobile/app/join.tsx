import { Redirect, router } from "expo-router";
import { useAuth } from "@clerk/expo";
import { Button, Copy, Screen, Section } from "@/components/ui";

/** Where a family link lands. `+native-intent` has already taken the code out of the address. */
export default function JoinLink() {
  const { isSignedIn } = useAuth();
  if (isSignedIn) return <Redirect href="/family" />;
  return <Screen title="Join a family">
    <Section title="You’ve been invited to a family">
      <Copy>Sign in or create an account, and your invitation will be waiting. Nothing is shared until you’ve read what joining means and said yes.</Copy>
      <Button title="Sign in" size="lg" onPress={() => router.push("/sign-in")} />
    </Section>
  </Screen>;
}
