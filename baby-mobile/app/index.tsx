import { Redirect } from "expo-router";
import { useAuth } from "@clerk/expo";
import { hasJoinLink } from "../lib/join-link";
export default function Index() {
  const { isSignedIn } = useAuth();
  return <Redirect href={!isSignedIn ? "/sign-in" : hasJoinLink() ? "/family" : "/(tabs)/(today)"} />;
}
