import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const importScreenSource = readFileSync(
  fileURLToPath(new URL('./app/(tabs)/index.tsx', import.meta.url)),
  'utf8',
);

const importHelpSource = readFileSync(
  fileURLToPath(new URL('./components/ImportPanels.tsx', import.meta.url)),
  'utf8',
);

describe('production App Store copy', () => {
  it('presents AI extraction as a finished feature instead of a beta', () => {
    expect(importScreenSource).not.toMatch(/\bbeta\b/i);
    expect(importHelpSource).not.toMatch(/\bbeta\b/i);
    expect(importHelpSource).toContain('AI-assisted recipe extraction');
    expect(importHelpSource).toContain(
      'Extracted and saved automatically. Any uncertain details will be highlighted.',
    );
  });
});
