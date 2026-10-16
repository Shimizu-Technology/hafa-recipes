import { Platform } from "react-native";
import { createCoachVoice, type Recognition } from "./coach-voice";

let recognition: Recognition | null = null;
try {
  if (Platform.OS !== "web") {
    // Older development binaries may not link this optional native module.
    const { ExpoSpeechRecognitionModule: native } = require("expo-speech-recognition") as typeof import("expo-speech-recognition");
    recognition = {
      available: () => native.isRecognitionAvailable(),
      permission: async () => (await native.requestPermissionsAsync()).granted,
      listen(events) {
        const subscriptions = [
          native.addListener("result", event => events.result(event.results[0]?.transcript ?? "")),
          native.addListener("error", event => events.error(event.error)),
          native.addListener("end", () => events.end()),
        ];
        return () => subscriptions.forEach(subscription => subscription.remove());
      },
      start: () => native.start({ lang: "en-US", interimResults: true, continuous: false, addsPunctuation: true, maxAlternatives: 1, recordingOptions: { persist: false } }),
      stop: () => native.stop(),
      abort: () => native.abort(),
    };
  }
} catch { /* Missing native code leaves typed coaching fully available. */ }

// One coordinator across route instances; listeners survive a canceled route
// only until the native end event releases the recognition lease.
export const coachVoice = createCoachVoice(recognition);
