import { Alert } from "react-native";
import type { useBaby } from "./context";
import type { Bootstrap } from "./models";

export const AI_CONSENT_TITLE = "Allow optional AI processing?";
export const AI_CONSENT_BODY =
  "When you process a post, OpenAI receives its text, images, audio or sampled video frames. " +
  "When you use Ask, OpenAI receives your question, relevant Baby records and recent conversation. " +
  "Recipes and Workouts data are not included. You can turn this off at any time in Settings.";

/** While the new Ask is on. Everyone reads this before their questions go to it. */
export const ASK_CONSENT_BODY =
  "When you process a post, OpenAI receives its text, images, audio or sampled video frames. " +
  "When you use Ask, OpenAI receives your question, the Baby records Ask looks up to answer it, and recent conversation. " +
  "When Ask searches the web, a search query made only from your question is sent to OpenAI's web search. " +
  "Personal or sensitive details in your question may remain in that query, even after filtering. " +
  "If you share a family space, every parent's Ask can use what's shared there. Your private journal goes only to your own Ask. " +
  "Recipes and Workouts data are not included. You can turn this off at any time in Settings.";
export const ASK_UPDATE_TITLE = "Ask can now do more";

export function consentCopy(bootstrap: Bootstrap | null | undefined) {
  return bootstrap?.ask_consent_version ? ASK_CONSENT_BODY : AI_CONSENT_BODY;
}

/** AI is on, but this person hasn't seen what the new Ask does. They stay on the old Ask until they have. */
export function needsAskAcknowledgment(bootstrap: Bootstrap | null | undefined) {
  return !!bootstrap?.ask_consent_version && !!bootstrap.profile.ai_consent &&
    bootstrap.profile.ai_consent_version !== bootstrap.ask_consent_version;
}

/** Ask in place instead of sending people to Settings. Resolves true only on "Allow processing". */
export function confirmAiConsent(body = AI_CONSENT_BODY, title = AI_CONSENT_TITLE): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      title,
      body,
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
  const result = await b.api.profile({ ...bootstrap.profile, ai_consent: true,
    ...(bootstrap.ask_consent_version ? { acknowledge_ai_consent_version: bootstrap.ask_consent_version } : {}) }, bootstrap.generation);
  await b.commit((s) => ({ ...s, bootstrap: { ...s.bootstrap!, profile: result } }));
}

/** True when AI may run now, asking for (and saving) consent first if needed. */
export async function ensureAiConsent(b: ReturnType<typeof useBaby>) {
  if (b.state.bootstrap?.profile.ai_consent) return true;
  if (!(await confirmAiConsent(consentCopy(b.state.bootstrap)))) return false;
  await enableAiConsent(b);
  return true;
}

/** Show what changed; on "Allow processing", record that this person saw this version. */
export async function acknowledgeAsk(b: ReturnType<typeof useBaby>) {
  if (!(await confirmAiConsent(ASK_CONSENT_BODY, ASK_UPDATE_TITLE))) return false;
  await enableAiConsent(b);
  return true;
}
