import { Redirect } from "expo-router";

/** Today now lives at the top of Train; older links to the Today tab land there. */
export default function TodayRedirect() {
  return <Redirect href="/(tabs)/plan" />;
}
