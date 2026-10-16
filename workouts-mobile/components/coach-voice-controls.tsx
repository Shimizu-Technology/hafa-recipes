import { useState } from "react";
import { View } from "react-native";
import { Button, Copy, Notice } from "./ui";
import type { useCoachVoice } from "@/lib/use-coach-voice";

export function CoachVoiceControls({ voice, disabled }: { voice: ReturnType<typeof useCoachVoice>; disabled: boolean }) {
  const [details, setDetails] = useState(false);
  const active = voice.preparing || voice.phase !== "idle";
  return <>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
    <Button title={voice.preparing ? "Cancel dictation preparation" : voice.phase === "permission" ? "Cancel voice permission request" : voice.phase === "listening" ? "Stop dictation" : voice.phase === "stopping" ? "Stopping voice input…" : "Dictate message"}
      icon={active ? "stop-circle-outline" : "mic-outline"} secondary size="sm" inline
      disabled={voice.unavailable || voice.phase === "stopping" || (!active && disabled)} onPress={voice.toggle} />
    {!active && <Button title={details ? "Hide voice input details" : "About voice input"} variant="ghost" size="sm" inline onPress={() => setDetails(value => !value)} />}
    </View>
    {!active && details && <Copy kind="small" tone="muted">Uses your device’s speech service. Review the editable text before sending.</Copy>}
    {active && <Copy kind="small">{voice.phase === "permission" ? "Waiting for microphone and speech permission. Canceling keeps your draft." : "Dictation edits your draft. Review it before sending; you can also stop and type."}</Copy>}
    {voice.guidance && <Notice>{voice.guidance.message}</Notice>}
    {voice.guidance?.settings && <Button title="Open microphone and speech Settings" variant="ghost" onPress={() => { void voice.settings(); }} />}
    {!!voice.preparationError && <Notice error>{voice.preparationError}</Notice>}
    {!!voice.settingsError && <Notice error>{voice.settingsError}</Notice>}
  </>;
}
