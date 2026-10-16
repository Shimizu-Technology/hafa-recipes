/** Editable dictation only: recognition never submits a coach request. */
export const VOICE_MESSAGE_LIMIT = 4000;
export function applyVoiceTranscript(base: string, transcript: string) {
  const text = transcript.trim();
  return `${base}${text && base && !/\s$/.test(base) ? " " : ""}${text}`.slice(0, VOICE_MESSAGE_LIMIT);
}
export function voiceGuidance(code: string) {
  if (code === "aborted") return null;
  const settings = code === "not-allowed";
  const messages: Record<string, string> = {
    "not-allowed": "Allow microphone and speech recognition in Settings, or type your message.",
    "no-speech": "No speech was heard. Your draft is kept; try again or type your message.",
    "speech-timeout": "No speech was heard. Your draft is kept; try again or type your message.",
    network: "Speech recognition could not connect. Your draft is kept; try again or type your message.",
    "audio-capture": "The microphone is unavailable. Another app may be using it; you can type instead.",
    "service-not-allowed": "Speech recognition is unavailable on this device. You can type your message.",
    "language-not-supported": "Speech recognition is unavailable for this language. You can type your message.",
    interrupted: "Dictation was interrupted. Your draft is kept; try again or type your message.",
    busy: "Voice input is still stopping. Wait a moment, or type your message.",
    unavailable: "Voice input is unavailable in this app or on this device. You can type your message.",
  };
  return { message: messages[code] ?? "Voice input could not finish. Your draft is kept; try again or type your message.", settings };
}
type Guidance = ReturnType<typeof voiceGuidance>;
export type Recognition = {
  available(): boolean;
  permission(): Promise<boolean>;
  listen(events: { result(text: string): void; error(code: string): void; end(): void }): () => void;
  start(): void;
  stop(): void;
  abort(): void;
};
type Capture = { scope: string; base: string; current(): boolean; write(value: string): void };
type Session = Capture & { cancelled: boolean; remove?: () => void };
type Phase = "idle" | "permission" | "listening" | "stopping";
type Snapshot = { scope: string; phase: Phase; guidance: Guidance };

/** Native events have no session IDs. Keep one lease until its end event, even
 * after route cleanup, so a late result cannot become a new session's text. */
export function createCoachVoice(recognition: Recognition | null) {
  let value: Snapshot = { scope: "", phase: "idle", guidance: null };
  let session: Session | null = null;
  const listeners = new Set<() => void>();
  function publish(next: Snapshot) { value = next; listeners.forEach(listener => listener()); }
  function finish(active: Session, guidance: Guidance = null) {
    if (session !== active) return;
    active.remove?.(); session = null;
    publish({ scope: active.scope, phase: "idle", guidance: !active.cancelled && active.current() ? guidance : null });
  }
  function cancel(scope: string) {
    const active = session;
    if (!active || active.scope !== scope) return;
    active.cancelled = true;
    const waitingPermission = value.phase === "permission";
    publish({ scope, phase: "stopping", guidance: null });
    // A permission dialog cannot be programmatically dismissed. Its completion
    // releases the lease without starting recognition or applying text.
    if (!waitingPermission) { try { recognition?.abort(); } catch { /* Wait for native end before reuse. */ } }
  }
  return {
    snapshot: () => value,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    cancel,
    clear(scope: string) { if (!session) publish({ scope, phase: "idle", guidance: null }); },
    stop(scope: string) {
      if (!session || session.scope !== scope) return;
      if (value.phase === "permission") { cancel(scope); return; }
      if (value.phase !== "listening") return;
      publish({ scope, phase: "stopping", guidance: null });
      try { recognition?.stop(); } catch { cancel(scope); }
    },
    async begin(capture: Capture) {
      if (!capture.current() || session) return;
      if (capture.base.length >= VOICE_MESSAGE_LIMIT) {
        publish({ scope: capture.scope, phase: "idle", guidance: { message: "Your message has reached 4,000 characters. Edit it before adding speech.", settings: false } });
        return;
      }
      let available = false;
      try { available = recognition?.available() ?? false; } catch { /* Older native binary. */ }
      if (!recognition || !available) {
        publish({ scope: capture.scope, phase: "idle", guidance: voiceGuidance("unavailable") }); return;
      }
      const active: Session = { ...capture, cancelled: false };
      session = active;
      publish({ scope: capture.scope, phase: "permission", guidance: null });
      try {
        const granted = await recognition.permission();
        if (active.cancelled || !active.current()) { finish(active); return; }
        if (!granted) { finish(active, voiceGuidance("not-allowed")); return; }
        let heardSpeech = false;
        active.remove = recognition.listen({
          result(text) {
            if (session !== active || active.cancelled || !active.current()) return;
            if (!text.trim()) return;
            heardSpeech = true;
            // Interim hypotheses replace one segment; they are never appended
            // to the previous hypothesis and never change the captured base.
            active.write(applyVoiceTranscript(active.base, text));
          },
          error(code) {
            if (session !== active || active.cancelled || !active.current()) return;
            publish({ scope: active.scope, phase: "stopping", guidance: voiceGuidance(code) });
          },
          end() { finish(active, value.guidance ?? (heardSpeech ? null : voiceGuidance("no-speech"))); },
        });
        publish({ scope: capture.scope, phase: "listening", guidance: null });
        recognition.start();
      } catch { finish(active, voiceGuidance("client")); }
    },
  };
}
