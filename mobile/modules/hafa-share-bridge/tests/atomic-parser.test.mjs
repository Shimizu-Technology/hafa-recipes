import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Exercise the installed, patched parser without loading Expo/React Native in
// Node. Replace only module imports/exports, preserving the parser's body.
const parserSource = readFileSync(new URL('../../../node_modules/expo-share-intent/build/utils.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/\bexport /g, '');
const parseShareIntent = runInNewContext(
  `${parserSource}\nparseShareIntent;`,
  { SHAREINTENT_DEFAULTVALUE: { files: null, type: null, text: null, webUrl: null }, console },
);

const metadataA = {
  captureKey: 'hafarecipesShareKey.a', captureId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  accountScopeId: 'scope-a', submitted: false, requestedIsPublic: false, location: 'Guam',
};
const metadataB = { ...metadataA, captureKey: 'hafarecipesShareKey.b', captureId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', submitted: true, jobId: 'job-b' };

function parsed(payload, metadata = metadataA) {
  return parseShareIntent(JSON.stringify({ ...payload, _hafa: metadata }), { debug: false });
}

describe('atomic native share identity through the provider parser', () => {
  it.each([
    { text: 'https://example.com/a', type: 'text' },
    { weburls: [{ url: 'https://example.com/a', meta: '{}' }], type: 'weburl' },
    { text: 'Recipe caption without a URL', type: 'text' },
    { files: [{ path: 'file:///tmp/recipe.jpg', mimeType: 'image/jpeg', fileName: 'recipe.jpg' }], type: 'media' },
  ])('preserves the exact capture metadata alongside each payload shape', (payload) => {
    expect(parsed(payload)._hafa).toEqual(metadataA);
  });

  it('keeps an already emitted A2 bound to A after B is received', () => {
    const eventA = parsed({ text: 'https://example.com/a' });
    const eventA2 = parsed({ text: 'https://example.com/a' });
    const eventB = parsed({ text: 'https://example.com/b' }, metadataB);
    expect(eventA2._hafa.captureId).toBe(eventA._hafa.captureId);
    expect(eventA2.webUrl).toBe('https://example.com/a');
    expect(eventA2._hafa.captureKey).toBe('hafarecipesShareKey.a');
    expect(eventB._hafa.captureId).not.toBe(eventA2._hafa.captureId);
    expect(eventB._hafa.jobId).toBe('job-b');
  });
});
