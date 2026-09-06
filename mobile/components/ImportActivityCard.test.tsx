import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
    TouchableOpacity: host('TouchableOpacity'),
    View: host('NativeView'),
  };
});
vi.mock('@expo/vector-icons/Ionicons', () => ({
  default: Object.assign(() => null, { glyphMap: {} }),
}));
vi.mock('@/components/Themed', async () => {
  const ReactModule = await import('react');
  return {
    Text: (props: Record<string, unknown>) =>
      ReactModule.createElement('ThemedText', props, props.children as React.ReactNode),
    useColors: () => ({
      backgroundElevated: '#fff', border: '#ddd', borderLight: '#eee', error: '#c00',
      success: '#070', text: '#111', textMuted: '#666', tint: '#066', warning: '#960',
    }),
  };
});
vi.mock('@/constants/Colors', () => ({
  fontFamily: { semibold: 'DMSans' },
  fontSize: { xs: 11, sm: 13, md: 15 },
  radius: { md: 14, full: 9999, xl: 28 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
}));

import {
  ImportActivityCard,
  importAgeLabel,
  importJobPresentation,
  importSourceLabel,
} from './ImportActivityCard';
import type { JobStatus } from '@/types/recipe';

const job = (overrides: Partial<JobStatus> = {}): JobStatus => ({
  id: 'job-1',
  url: 'https://www.youtube.com/watch?v=abc',
  status: 'completed',
  progress: 100,
  current_step: 'complete',
  message: 'Done',
  recipe_id: 'recipe-1',
  error_message: null,
  created_at: '2026-09-07T00:00:00Z',
  updated_at: '2026-09-07T00:01:00Z',
  completed_at: '2026-09-07T00:01:00Z',
  ...overrides,
});

describe('ImportActivityCard', () => {
  it('uses provider-safe labels and concise relative times', () => {
    expect(importSourceLabel('https://youtu.be/abc')).toBe('YouTube');
    expect(importSourceLabel('https://www.instagram.com/reel/abc')).toBe('Instagram');
    expect(importSourceLabel('not a URL')).toBe('Recipe link');
    expect(importAgeLabel('2026-09-07T00:00:00Z', Date.parse('2026-09-07T02:00:00Z'))).toBe('2h ago');
  });

  it('makes uncertain completions a review task and failures retryable', () => {
    expect(importJobPresentation(job({ review_state: 'needs_review' }))).toMatchObject({
      action: 'open', actionLabel: 'Review', label: 'Ready for review',
    });
    expect(importJobPresentation(job({ status: 'failed', recipe_id: null }))).toMatchObject({
      action: 'restore', actionLabel: 'View options', label: 'Needs attention',
    });
    expect(importJobPresentation(job({
      status: 'failed', recipe_id: 'saved-draft', review_state: 'source_incomplete',
    }))).toMatchObject({
      action: 'open', actionLabel: 'Review', label: 'Draft needs details',
    });
  });

  it('routes each visible action explicitly and exposes active progress', async () => {
    const onOpenRecipe = vi.fn();
    const onRestore = vi.fn();
    const active = job({
      id: 'active', status: 'processing', progress: 42, recipe_id: null,
      completed_at: null,
    });
    const failed = job({ id: 'failed', status: 'failed', recipe_id: null });
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ImportActivityCard
          jobs={[active, job(), failed, job({ id: 'cancelled', status: 'cancelled' })]}
          onOpenRecipe={onOpenRecipe}
          onRestore={onRestore}
        />,
      );
    });

    const buttons = renderer!.root.findAllByType('TouchableOpacity' as unknown as React.ComponentType);
    buttons.find((button) => button.props.accessibilityLabel === 'View progress YouTube import')!.props.onPress();
    buttons.find((button) => button.props.accessibilityLabel === 'Open YouTube import')!.props.onPress();
    buttons.find((button) => button.props.accessibilityLabel === 'View options YouTube import')!.props.onPress();

    expect(onRestore).toHaveBeenCalledWith(active);
    expect(onOpenRecipe).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }));
    expect(onRestore).toHaveBeenCalledWith(failed);
    expect(renderer!.root.findByProps({ accessibilityRole: 'progressbar' }).props.accessibilityValue)
      .toEqual({ min: 0, max: 100, now: 42 });
    expect(renderer!.root.findAllByProps({ children: 'Cancelled' })).toHaveLength(0);
  });
});
