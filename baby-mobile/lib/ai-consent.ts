import { Alert } from "react-native";
import type { useBaby } from "./context";

export const AI_CONSENT_TITLE = "Allow optional AI processing?";
export const AI_CONSENT_BODY =
  "When you process a post, OpenAI receives its text, images, audio or sampled video frames. " +
  "When you use Ask, OpenAI receives your question, relevant Baby records and recent conversation. " +
  "Recipes and Workouts data are not included. You can turn this off at any time in Settings.";

/** Ask in place instead of sending people to Settings. Resolves true only on "Allow processing". */
export function confirmAiConsent(): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      AI_CONSENT_TITLE,
      AI_CONSENT_BODY,
      [
        { text: "Keep off", style: "cancel", onPress: () => resolve(false) },
        { text: "Allow processing", onPress: () => resolve(true) },
      ],
      { onDismiss: () => resolve(false) }
    )
  );
}

/** Same server change as the Settings switch: turn AI processing on for this account. */
export async function enableAiConsent(b: ReturnType<typeof useBaby>) {
  const bootstrap = b.state.bootstrap!;
  const result = await b.api.profile({ ...bootstrap.profile, ai_consent: true }, bootstrap.generation);
  await b.commit((s) => ({ ...s, bootstrap: { ...s.bootstrap!, profile: result } }));
}

/** True when AI may run now, asking for (and saving) consent first if needed. */
export async function ensureAiConsent(b: ReturnType<typeof useBaby>) {
  if (b.state.bootstrap?.profile.ai_consent) return true;
  if (!(await confirmAiConsent())) return false;
  await enableAiConsent(b);
  return true;
}
