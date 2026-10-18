import { Redirect, useLocalSearchParams } from "expo-router";

/** Keep source-app shares and existing capture links on the canonical Extract screen. */
export default function Capture() {
  const params = useLocalSearchParams();
  return <Redirect href={{ pathname: "/(tabs)/extract", params }} />;
}
