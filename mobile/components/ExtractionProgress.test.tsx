import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('./Themed', () => ({
  Text: (props: { children?: React.ReactNode }) => React.createElement('Text', props, props.children),
  useColors: () => ({ border: '#333', textSecondary: '#aaa', textMuted: '#888', error: '#f00' }),
}));
import ExtractionProgress from './ExtractionProgress';

describe('retry progress details', () => {
  it.each([[0, '1'], [1, '2'], [5, '3'], [undefined, '1']])('displays the next attempt for completed count %s', async (attemptCount, next) => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<ExtractionProgress progress={0} currentStep="retrying" message="" elapsedTime={2}
        isRetrying attemptCount={attemptCount} maxAttempts={3} />);
    });
    const renderedText = renderer.root.findAll(node => String(node.type) === 'Text').map(node => node.children.join('')).join('\n');
    expect(renderedText).toContain(`Attempt ${next} of 3`);
    await act(async () => renderer.unmount());
  });
});
