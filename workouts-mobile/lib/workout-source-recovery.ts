import type { ExtractionRequest } from "./capture";
export interface SourceRecoveryInput { source_url: string; caption: string; update_existing?: boolean }
export interface SourceRecoveryCommand { request_id: string; source: ExtractionRequest; auto_save: boolean; replace_target?: { workout_id: string; expected_revision: number } }
export function sourceRecoveryRequest(input: SourceRecoveryInput): ExtractionRequest {
  const url = input.source_url.trim(), text = input.caption.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname || url.length > 2000) throw Error();
    } catch { throw Error("Use a complete http or https source link without account credentials."); }
  }
  if (text.length > 30000) throw Error("Use up to 30,000 characters of caption or transcript.");
  if (!url && !text) throw Error("Paste the creator’s caption or transcript, or add the original source link.");
  return { kind: url ? "url" : "text", ...(url ? { source_url: url } : {}), ...(text ? { text } : {}), ai_consent: true, typed_formats: true };
}
