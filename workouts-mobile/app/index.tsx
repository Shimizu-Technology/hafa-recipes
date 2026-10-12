import { Redirect } from "expo-router";
import { useAuth } from "@clerk/expo";
export default function RootDestination() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  return <Redirect href={isSignedIn ? "/(tabs)" : "/sign-in"} />;
}
