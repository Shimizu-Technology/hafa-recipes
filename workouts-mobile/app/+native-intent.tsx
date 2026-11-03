import { configuration } from "@/lib/config";
import { previewEnabled } from "@/constants/looks";
import { incomingNativePath } from "@/lib/native-intent";
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return incomingNativePath(path, {
    designPreview: previewEnabled(configuration.environment),
    websiteOrigin: process.env.EXPO_PUBLIC_WORKOUTS_WEBSITE_URL,
    development: process.env.NODE_ENV === "development",
  });
}
