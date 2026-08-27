import { addBreadcrumb } from './sentry';

export type ChatMode = 'general' | 'recipe';
export type ChatTelemetryEvent =
  | 'opened'
  | 'message_started'
  | 'message_completed'
  | 'message_cancelled'
  | 'message_failed'
  | 'voice_failed';

type ChatTelemetryFacts = {
  mode: ChatMode;
  hasImage?: boolean;
  contextMessageCount?: number;
  durationMs?: number;
};

/**
 * Record chat health without accepting message text, recipe details, URLs, or IDs.
 */
export function trackChatEvent(
  event: ChatTelemetryEvent,
  facts: ChatTelemetryFacts,
): void {
  const data: Record<string, boolean | number | string> = { mode: facts.mode };
  if (typeof facts.hasImage === 'boolean') data.hasImage = facts.hasImage;
  if (typeof facts.contextMessageCount === 'number') {
    data.contextMessageCount = Math.max(0, Math.round(facts.contextMessageCount));
  }
  if (typeof facts.durationMs === 'number') {
    data.durationMs = Math.max(0, Math.round(facts.durationMs));
  }
  try {
    addBreadcrumb(
      'ui',
      `Chat ${event.replaceAll('_', ' ')}`,
      data,
      event === 'message_failed' || event === 'voice_failed' ? 'warning' : 'info',
    );
  } catch {
    // Diagnostics must never interrupt the chat flow.
  }
}
