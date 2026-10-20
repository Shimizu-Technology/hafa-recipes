export function checkAuthConfiguration(key?: string, environment?: string, appEnvironment?: string): string | null {
  if (!key) return "This build needs its Håfa sign-in configuration.";
  if (environment !== "development" && environment !== "production")
    return "The sign-in environment must be explicitly configured.";
  if (appEnvironment === "production" && environment !== "production")
    return "A production build requires production sign-in.";
  if (
    (environment === "production" && !key.startsWith("pk_live_")) ||
    (environment === "development" && !key.startsWith("pk_test_"))
  )
    return "The sign-in key does not match this build’s environment.";
  return null;
}
export const configuration = {
  apiBase: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  clerkKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "",
  clerkEnvironment: process.env.EXPO_PUBLIC_CLERK_ENVIRONMENT,
  environment: process.env.EXPO_PUBLIC_APP_ENV ?? "development",
};
