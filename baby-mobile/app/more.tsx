import { Redirect } from "expo-router";
/** Preserve the old /more deep link; settings now live behind the profile. */
export default function More() { return <Redirect href="/settings" />; }
