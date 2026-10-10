import { incomingNativePath } from "@/lib/native-intent";
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return incomingNativePath(path, {
    websiteOrigin: process.env.EXPO_PUBLIC_WORKOUTS_WEBSITE_URL,
    development: process.env.NODE_ENV === "development",
  });
}
