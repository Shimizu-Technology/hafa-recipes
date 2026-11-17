import { describe, expect, it } from 'vitest';
import type { Recipe } from '@/types/recipe';
import {
  formatLinkCreated,
  formatRecipeShareText,
  getRecipeShareMode,
  getShareFootnote,
  getShareSheetModel,
  getSourceCredit,
  publicRecipeLink,
  recipeCreditLine,
  resolveLinkRequest,
} from './recipeShare';

const ID = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const KEY = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';

function recipe(overrides: Partial<Recipe['extracted']> = {}, sourceUrl = 'https://www.tiktok.com/@thecoreyb/video/7312345678901234567'): Recipe {
  return {
    id: ID, source_url: sourceUrl, source_type: 'tiktok', thumbnail_url: null, extraction_method: null, extraction_quality: null,
    has_audio_transcript: false, created_at: '2026-11-01T00:00:00Z', user_id: 'u1', extractor_display_name: 'Leon Shimizu',
    is_public: true, moderation_status: 'active',
    extracted: {
      title: 'No-Knead Sunday Bread', sourceUrl, servings: 8, times: { prep: null, cook: null, total: '70 min' } as any,
      components: [{ name: 'Bread', ingredients: [
        { name: 'bread flour', quantity: '3', unit: 'cups' },
        { name: 'salt', quantity: null, unit: null, quantityEstimate: { quantity: '0.5', unit: 'tsp' } as any },
        { name: 'black pepper', quantity: null, unit: null, notes: 'to taste' },
      ], steps: ['Mix everything.', 'Rest overnight.'] }],
      ingredients: [], steps: [], equipment: ['Dutch oven'], notes: 'The long cool prevents a gummy crumb.', tags: ['bread', 'easy'],
      media: {} as any, totalEstimatedCost: 4.2, costLocation: 'Guam',
      nutrition: { calories: 200 } as any,
      ...overrides,
    },
  } as Recipe;
}

const idle = { loading: false, unavailable: false, active: false, url: null };

describe('share mode', () => {
  it.each([
    [true, true, 'active', 'public'], [true, false, 'active', 'private'], [true, true, 'hidden', 'under-review'],
    [false, true, 'active', 'public'], [false, false, 'active', 'text-only'], [false, true, 'hidden', 'text-only'],
  ] as const)('owner=%s public=%s %s → %s', (isOwner, isPublic, moderation, mode) => {
    expect(getRecipeShareMode({ is_public: isPublic, moderation_status: moderation }, isOwner)).toBe(mode);
  });

  it('offers a link for public recipes and for private ones the owner can link', () => {
    expect(getShareSheetModel('public', idle)).toEqual({ primary: 'send-link', showCopyLink: true, showLinkStatus: false });
    expect(getShareSheetModel('private', idle)).toEqual({ primary: 'send-link', showCopyLink: true, showLinkStatus: false });
    expect(getShareSheetModel('private', { ...idle, active: true })).toMatchObject({ showLinkStatus: true });
  });

  it('falls back to text when no link can open', () => {
    for (const mode of ['under-review', 'text-only'] as const) {
      expect(getShareSheetModel(mode, idle)).toEqual({ primary: 'send-text', showCopyLink: false, showLinkStatus: false });
    }
    expect(getShareSheetModel('private', { ...idle, unavailable: true }).primary).toBe('send-text');
  });

  it('says plainly who can open the recipe', () => {
    expect(getShareFootnote('private', { linkActive: true })).toBe('Anyone with this link can open it. It won’t appear in Discover.');
    expect(getShareFootnote('private')).toContain('Only you can open it');
    expect(getShareFootnote('public', { contributorName: 'Ana' })).toContain('Recipe by Ana in Discover');
    expect(getShareFootnote('under-review')).toContain('Under review');
  });
});

describe('link requests', () => {
  it('uses the recipe’s own link when it is public, with no API call needed', () => {
    expect(resolveLinkRequest('public', ID, idle)).toEqual({ kind: 'ready', url: `https://hafa-recipes.com/r/${ID}` });
  });

  it('confirms before creating the first private link', () => {
    expect(resolveLinkRequest('private', ID, idle)).toEqual({ kind: 'confirm-create' });
  });

  it('reuses the link kept on this phone', () => {
    const url = `https://hafa-recipes.com/r/${KEY}`;
    expect(resolveLinkRequest('private', ID, { ...idle, active: true, url })).toEqual({ kind: 'ready', url });
  });

  it('asks before replacing an active link this phone never saw', () => {
    expect(resolveLinkRequest('private', ID, { ...idle, active: true })).toEqual({ kind: 'confirm-replace' });
  });

  it('waits for the status check and never links hidden or unavailable recipes', () => {
    expect(resolveLinkRequest('private', ID, { ...idle, loading: true })).toEqual({ kind: 'wait' });
    // A failed status check is not "no link": creating one now could replace a link people already have.
    expect(resolveLinkRequest('private', ID, { ...idle, error: true })).toEqual({ kind: 'error' });
    expect(resolveLinkRequest('private', ID, { ...idle, error: true, active: true, url: 'https://hafa-recipes.com/r/x' })).toEqual({ kind: 'error' });
    expect(resolveLinkRequest('private', ID, { ...idle, unavailable: true })).toEqual({ kind: 'none' });
    expect(resolveLinkRequest('under-review', ID, idle)).toEqual({ kind: 'none' });
  });
});

describe('send as text', () => {
  it('is short and readable: no rules, cost, tags, nutrition or equipment', () => {
    const text = formatRecipeShareText(recipe(), { link: publicRecipeLink(ID) });
    expect(text).toBe([
      'No-Knead Sunday Bread',
      'Serves 8 · 70 min',
      '',
      'Ingredients',
      '• 3 cups bread flour',
      '• ≈ ½ tsp salt',
      '• black pepper, to taste',
      '',
      'Steps',
      '1. Mix everything.',
      '2. Rest overnight.',
      '',
      'Notes: The long cool prevents a gummy crumb.',
      '',
      '≈ amount estimated by Håfa',
      'Original: https://www.tiktok.com/@thecoreyb/video/7312345678901234567 (by @thecoreyb)',
      `Open it in Håfa Recipes: https://hafa-recipes.com/r/${ID}`,
    ].join('\n'));
    expect(text).not.toMatch(/[━─$]|Tags|NUTRITION|Dutch oven|AI estimate|calories/i);
  });

  it('follows the chosen scale and says what it was scaled from', () => {
    const text = formatRecipeShareText(recipe(), { servings: 12 });
    expect(text).toContain('Serves 12 (scaled from 8) · 70 min');
    expect(text).toContain('• 4½ cups bread flour');
    expect(text).toContain('• ≈ ¾ tsp salt');
  });

  it('uses component names as plain subheads and keeps step numbers running', () => {
    const text = formatRecipeShareText(recipe({ components: [
      { name: 'Dough', ingredients: [{ name: 'flour', quantity: '2', unit: 'cups' }], steps: ['Knead.'] },
      { name: 'Glaze', ingredients: [{ name: 'honey', quantity: '1', unit: 'tbsp' }], steps: ['Brush on.'] },
    ] }), {});
    expect(text).toContain('Ingredients\nDough\n• 2 cups flour\n\nGlaze\n• 1 tbsp honey');
    expect(text).toContain('Steps\nDough\n1. Knead.\n\nGlaze\n2. Brush on.');
  });

  it('credits a Discover contributor and ends with Håfa even without a link', () => {
    const text = formatRecipeShareText({ ...recipe(), source_url: 'manual://x', source_type: 'manual' }, { contributorName: 'Ana' });
    expect(text.split('\n').slice(-2)).toEqual(['Recipe by Ana on Håfa', 'Shared from Håfa Recipes']);
    expect(text).not.toContain('Original');
  });
});

describe('source credit', () => {
  it.each([
    ['https://www.tiktok.com/@thecoreyb/video/123', 'tiktok', 'TikTok video by @thecoreyb'],
    ['https://vm.tiktok.com/ZMabc/', 'tiktok', 'TikTok video'],
    ['https://www.instagram.com/reel/abc/', 'instagram', 'Instagram post'],
    ['https://youtu.be/abc', 'youtube', 'YouTube video'],
    ['https://www.seriouseats.com/bread', 'website', 'Recipe from seriouseats.com'],
  ])('%s → %s', (url, type, label) => {
    expect(getSourceCredit(url, type)?.label).toBe(label);
  });

  it.each(['manual://x', 'photo://upload', '', 'javascript:alert(1)'])('has no original for %s', url => {
    expect(getSourceCredit(url, 'manual')).toBeNull();
  });
});

describe('link status', () => {
  it('formats when the link was made', () => {
    const now = new Date('2026-11-20T12:00:00');
    expect(formatLinkCreated('2026-11-16T03:00:00', now)).toBe('Link active · created Nov 16');
    expect(formatLinkCreated('2025-12-01T03:00:00', now)).toBe('Link active · created Dec 1, 2025');
    expect(formatLinkCreated(null, now)).toBe('Link active');
  });
});

describe('credit line under the title', () => {
  const base = { source_url: 'https://www.instagram.com/@lanicooks/reel/abc/', source_type: 'instagram', extractor_display_name: 'Leon' };
  it('keeps the usual source and importer for ordinary recipes', () => {
    expect(recipeCreditLine({ ...base, extracted: {} }, 'Instagram')).toBe('Instagram · Leon');
  });
  it('credits the original creator and the sharer on a saved copy, never the viewer', () => {
    const copy = { ...base, extractor_display_name: null, extracted: { sharedCopy: { sharedBy: 'Lani' } } };
    expect(recipeCreditLine(copy, 'Instagram')).toBe('Instagram post by @lanicooks · Shared by Lani');
    expect(recipeCreditLine({ ...copy, extracted: { sharedCopy: { sharedBy: null } } }, 'Instagram')).toBe('Instagram post by @lanicooks');
    expect(recipeCreditLine({ ...copy, source_url: 'https://example.com/rice', source_type: 'website' }, 'Website')).toBe('Website · Shared by Lani');
    // An older copy whose own name column was set is still credited to the original, not that name.
    expect(recipeCreditLine({ ...copy, extractor_display_name: 'A Håfa cook' }, 'Instagram')).not.toContain('A Håfa cook');
  });
});
