import type { ActualWorkout } from "./types";
export interface PausedWorkoutWriter {
  savePausedWorkout(payload: string): Promise<string>;
}
export async function nativePausedWriter(): Promise<PausedWorkoutWriter | null> {
  try {
    const { requireOptionalNativeModule } = await import("expo-modules-core");
    return requireOptionalNativeModule<PausedWorkoutWriter>("HafaPausedHealth");
  } catch {
    return null;
  }
}
export function pausedWritePayload(workout: ActualWorkout, activity: number) {
  return JSON.stringify({ ...workout, activity_type: activity });
}
