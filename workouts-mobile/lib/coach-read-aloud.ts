import type { SpeechOptions } from "expo-speech";
import type { CoachMessage } from "./coach";

export const READ_ALOUD_LIMIT = 4000;
export function readAloudText(markdown: string) {
  if (markdown.length > 16000) return "";
  const plain = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, "")
    .replace(/<\/?[A-Za-z][^<>]*>/g, " ").replace(/^[ \t]*```[^`\n]*(?:\n|$)/gm, " ")
    .replace(/^[ \t]*(?:#{1,6}|>|[-*+])(?:[ \t]+|$)/gm, "")
    .replace(/(\d)\s*\*\s*(?=\d)/g, "$1 times ").replace(/[*_`~]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return plain;
}
export function speechChunks(text: string, deviceLimit: number) {
  if (!Number.isFinite(deviceLimit) || deviceLimit < 2) throw Error("Speech input limit unavailable");
  const cap = Math.min(READ_ALOUD_LIMIT, Math.floor(deviceLimit)), chunks: string[] = [];
  let chunk = "";
  for (const point of text) {
    if (chunk.length + point.length > cap) { chunks.push(chunk); chunk = ""; }
    chunk += point;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
type Voice = { identifier: string; language?: string; localService?: boolean };
export interface DeviceSpeech {
  maxSpeechInputLength: number;
  getAvailableVoicesAsync(): Promise<Voice[]>;
  speak(text: string, options: SpeechOptions): void;
  stop(): Promise<void>;
  isSpeakingAsync(): Promise<boolean>;
}
type Capture = { scope: object; current(): boolean; message: CoachMessage };
type Session = Capture & { cancelled: boolean; cancelLookup?: () => void; utterance?: object };
const stopGuidance = "Couldn’t confirm speech stopped. Retry stopping speech before reading another reply or using the microphone.";
const guidance = "Couldn’t read this reply aloud. Check your device’s speech voices and try again, or keep reading on screen.";
export type ReadAloudSnapshot = { scope: object | null; messageId: string | null; phase: "idle" | "starting" | "reading" | "stopping" | "stop_failed"; error: string };

/** A single device speech lease. Retired callbacks cannot affect its successor. */
export function createCoachReadAloud(speech: DeviceSpeech, localWebVoice = false) {
  let value: ReadAloudSnapshot = { scope: null, messageId: null, phase: "idle", error: "" };
  let session: Session | null = null;
  let tail: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (next: ReadAloudSnapshot) => { value = next; listeners.forEach(listener => listener()); };
  const current = (active: Session) => session === active && !active.cancelled && active.current();
  async function quiet() {
    let timeout!: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        (async () => { await speech.stop(); if ((await speech.isSpeakingAsync()) !== false) throw Error(stopGuidance); })(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(Error(stopGuidance)), 5000); }),
      ]);
    } finally { clearTimeout(timeout); }
  }
  function finish(active: Session, error = "") {
    if (session !== active) return;
    session = null;
    publish({ scope: active.scope, messageId: null, phase: "idle", error: !active.cancelled && active.current() ? error : "" });
  }
  function stopFailed(active: Session) {
    if (session !== active) return;
    active.cancelled = true;
    publish({ scope: active.scope, messageId: active.message.id, phase: "stop_failed", error: stopGuidance });
  }
  function stop(scope?: object) {
    const active = session;
    if (!active || active.cancelled && value.phase !== "stop_failed" || scope && active.scope !== scope && value.phase !== "stop_failed") return tail;
    active.cancelled = true;
    active.cancelLookup?.();
    publish({ scope: active.scope, messageId: active.message.id, phase: "stopping", error: "" });
    tail = tail.catch(() => undefined).then(() => quiet()).then(
      () => finish(active), () => {
        if (session !== active) return; // A native end/stopped callback already confirmed completion.
        stopFailed(active);
        throw Error(stopGuidance);
      },
    );
    // Cleanup calls may intentionally ignore a native failure; explicit callers still receive it.
    void tail.catch(() => undefined);
    return tail;
  }
  return {
    snapshot: () => value,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    stop,
    begin(capture: Capture) {
      if (!capture.current() || capture.message.state !== "completed" || !capture.message.assistant_message ||
          value.phase === "starting" || value.phase === "stopping" || value.phase === "stop_failed") return;
      if (session) session.cancelled = true;
      const active: Session = { ...capture, cancelled: false };
      session = active;
      publish({ scope: active.scope, messageId: active.message.id, phase: "starting", error: "" });
      tail = tail.catch(() => undefined).then(async () => {
        try { await quiet(); }
        catch { stopFailed(active); return; }
        if (!current(active)) { finish(active); return; }
        let cancel!: () => void;
        const cancelled = new Promise<never>((_, reject) => { cancel = () => reject(Error(guidance)); });
        active.cancelLookup = cancel;
        const timeout = setTimeout(cancel, 5000);
        let voices: Voice[];
        try { voices = await Promise.race([speech.getAvailableVoicesAsync(), cancelled]); }
        finally { clearTimeout(timeout); active.cancelLookup = undefined; }
        if (!current(active)) { finish(active); return; }
        const available = voices.filter(item => !localWebVoice || item.localService === true);
        const voice = available.find(item => /^en(?:[-_]|$)/i.test(item.language ?? "")) ?? available[0];
        const chunks = speechChunks(readAloudText(active.message.assistant_message!), speech.maxSpeechInputLength);
        if (!voice || !chunks.length) throw Error(guidance);
        let index = 0;
        const speakNext = () => {
          if (!current(active)) return;
          const token = {}; active.utterance = token;
          const owns = () => session === active && active.utterance === token;
          try { speech.speak(chunks[index], { voice: voice.identifier, useApplicationAudioSession: false,
            onDone: () => {
              if (!owns()) return;
              active.utterance = undefined;
              if (current(active) && ++index < chunks.length) speakNext(); else finish(active);
            },
            onStopped: () => { if (owns()) finish(active); },
            onError: () => { if (owns() && !active.cancelled) finish(active, guidance); },
          }); } catch { finish(active, guidance); }
        };
        publish({ scope: active.scope, messageId: active.message.id, phase: "reading", error: "" });
        speakNext();
      }).catch(() => finish(active, guidance));
    },
  };
}
