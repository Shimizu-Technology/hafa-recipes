import { HealthError, type HealthProvider } from "./types";

/** Metro selects .ios/.android for native builds; web/Node never loads Nitro. */
export async function createNativeHealthProvider(): Promise<HealthProvider> {
  const unavailable = async (): Promise<never> => {
    throw new HealthError("native_build_required", "Health connections require the native iPhone or Android app.");
  };
  return {
    platform: "unavailable",
    availability: async () => ({
      status: "native_build_required",
      message: "Use the native iPhone or Android app for health connections.",
    }),
    access: async () => ({
      read: "unknown",
      write: "not_requested",
      message: "Health records are unavailable on this platform.",
    }),
    requestAccess: unavailable,
    readPage: unavailable,
    exportActual: unavailable,
    deleteOwned: unavailable,
    openSettings: unavailable,
  };
}
