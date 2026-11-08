import { router } from "expo-router";
import { Copy, PressTarget } from "./ui";

/** Keep AFTER urgent actions. No account or network needed. */
export function HealthNote() {
  return <PressTarget accessibilityRole="link" accessibilityLabel="About the health information" onPress={() => router.push("/health-information")} style={{ minHeight: 44, justifyContent: "center" }}>
    <Copy kind="small" tone="muted">General information, not medical advice. Check with your doctor.</Copy>
  </PressTarget>;
}
