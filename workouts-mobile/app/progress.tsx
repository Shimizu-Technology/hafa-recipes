import { Redirect, useLocalSearchParams } from "expo-router";

export default function LegacyDestination() {
  const params = useLocalSearchParams();
  return <Redirect href={{ pathname: "/history-progress", params }} />;
}
