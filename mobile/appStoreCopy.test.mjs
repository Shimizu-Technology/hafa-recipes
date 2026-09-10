import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const importScreenSource = readFileSync(
  fileURLToPath(new URL('./app/(tabs)/index.tsx', import.meta.url)),
  'utf8',
);

describe('production App Store copy', () => {
  it('presents AI extraction as a finished feature instead of a beta', () => {
    expect(importScreenSource).not.toMatch(/\bbeta\b/i);
    expect(importScreenSource).toContain('>AI-ASSISTED<');
    expect(importScreenSource).toContain(
      'Extracted and saved automatically. Any uncertain details will be highlighted.',
    );
  });
});
