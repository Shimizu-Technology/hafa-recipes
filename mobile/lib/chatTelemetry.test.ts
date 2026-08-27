import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ addBreadcrumb: vi.fn() }));

vi.mock('./sentry', () => ({ addBreadcrumb: mocks.addBreadcrumb }));

import { trackChatEvent } from './chatTelemetry';

describe('privacy-safe chat telemetry', () => {
  beforeEach(() => mocks.addBreadcrumb.mockClear());

  it('records only bounded operational facts', () => {
    trackChatEvent('message_completed', {
      mode: 'recipe',
      hasImage: true,
      contextMessageCount: 3.4,
      durationMs: 105.8,
    });

    expect(mocks.addBreadcrumb).toHaveBeenCalledWith(
      'ui',
      'Chat message completed',
      {
        mode: 'recipe',
        hasImage: true,
        contextMessageCount: 3,
        durationMs: 106,
      },
      'info',
    );
  });

  it('marks failures as warnings without accepting free-form error details', () => {
    trackChatEvent('voice_failed', { mode: 'general' });

    expect(mocks.addBreadcrumb).toHaveBeenCalledWith(
      'ui',
      'Chat voice failed',
      { mode: 'general' },
      'warning',
    );
  });

  it('never lets diagnostics interrupt chat', () => {
    mocks.addBreadcrumb.mockImplementationOnce(() => {
      throw new Error('telemetry unavailable');
    });

    expect(() => trackChatEvent('opened', { mode: 'general' })).not.toThrow();
  });
});
