import { Redirect } from "expo-router";
import { useAuth } from "@clerk/expo";
export default function Index() {
  const { isSignedIn } = useAuth();
  return <Redirect href={isSignedIn ? "/(tabs)/(today)" : "/sign-in"} />;
}
