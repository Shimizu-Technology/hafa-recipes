import { Button, Copy, IconButton, Notice } from "./ui";
import type { useCoachVoice } from "@/lib/use-coach-voice";

type Voice = ReturnType<typeof useCoachVoice>;
const active = (voice: Voice) => voice.preparing || voice.phase !== "idle";

/** Round mic button for the composer row. */
export function CoachVoiceButton({ voice, disabled }: { voice: Voice; disabled: boolean }) {
  const on = active(voice);
  return <IconButton
    label={voice.preparing ? "Cancel dictation preparation" : voice.phase === "permission" ? "Cancel voice permission request" : voice.phase === "listening" ? "Stop dictation" : voice.phase === "stopping" ? "Stopping voice input…" : "Dictate message"}
    icon={on ? "stop-circle-outline" : "mic-outline"} variant={on ? "primary" : "plain"}
    disabled={voice.unavailable || voice.phase === "stopping" || (!on && disabled)} onPress={voice.toggle} />;
}

/** Dictation status and recovery, shown above the composer only when relevant. */
export function CoachVoiceStatus({ voice }: { voice: Voice }) {
  return <>
    {active(voice) && <Copy kind="small" tone="muted">{voice.phase === "permission" ? "Waiting for microphone and speech permission. Canceling keeps your draft." : "Listening… Your words appear in the message. Review it before sending."}</Copy>}
    {voice.guidance && <Notice>{voice.guidance.message}</Notice>}
    {voice.guidance?.settings && <Button title="Open microphone and speech Settings" variant="ghost" size="sm" inline onPress={() => { void voice.settings(); }} />}
    {!!voice.preparationError && <Notice error>{voice.preparationError}</Notice>}
    {!!voice.settingsError && <Notice error>{voice.settingsError}</Notice>}
  </>;
}
