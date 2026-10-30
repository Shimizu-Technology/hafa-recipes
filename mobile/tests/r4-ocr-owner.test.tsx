const scanFiles = vi.hoisted(() => new Set<string>());
vi.mock('@react-native-async-storage/async-storage', () => { const data = new Map<string,string>(); return { default: { getItem: async(k:string)=>data.get(k)??null, setItem:async(k:string,v:string)=>{data.set(k,v)}, getAllKeys:async()=>[...data.keys()], multiRemove:async(ks:string[])=>{ks.forEach(k=>data.delete(k))} } }; });
vi.mock('expo-file-system', () => ({ Paths: { document: 'file:///private' },
  Directory: class { uri: string; constructor(...parts: string[]) { this.uri = parts.join('/') + '/'; } },
  File: class { constructor(public uri: string) {} get exists() { return scanFiles.has(this.uri); } delete() { scanFiles.delete(this.uri); } },
}));
vi.mock('@/lib/privateRecipeDrafts', () => ({ privateRecipeDrafts: { write: vi.fn(async () => undefined), read: vi.fn(async () => ({ captureId: mocks.params.captureId })), lease: (owner: string) => ({ owner }), remove: vi.fn(async () => undefined) } }));
vi.mock('@/lib/importInbox', () => ({ importInbox: { patch: mocks.patchInbox } }));
vi.mock('@/hooks/useImportInbox', () => ({ useImportInbox: () => ({ ownerId: offlineRecipes.lease('subject')?.owner ?? mocks.ownerId, entries: mocks.entries.filter((entry) => entry.state !== 'accepted') }) }));
import { recoverFailedCaptureSave } from '@/lib/captureSaveRecovery';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  ownerId: 'owner-a',
  entries: [] as any[], patchInbox: vi.fn(),
  alert: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  requestPublishing: vi.fn(async () => true),
  save: vi.fn(async (params: { is_public: boolean }) => ({
    id: 'recipe-1',
    is_public: params.is_public,
  })),
  params: {
    recipe: '',
    originalPages: undefined as string | undefined, savedRecipeId: undefined as string | undefined,
    captureOwnerId: undefined as string | undefined,
    saveFailed: undefined as string | undefined,
    captureId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    saveErrorKind: undefined as string | undefined,
    saveErrorMessage: undefined as string | undefined,
    location: 'Guam',
    isPublic: 'false',
    sourceType: 'photo' as 'photo' | 'text',
  },
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);

  return {
    Alert: { alert: mocks.alert },
    ScrollView: host('ScrollView'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    TouchableOpacity: host('TouchableOpacity'),
    View: host('NativeView'),
  };
});

vi.mock('expo-router', () => {
  const Stack = () => null;
  Stack.Screen = () => null;
  return {
    Stack,
    useLocalSearchParams: () => mocks.params,
    useRouter: () => ({ back: mocks.back, replace: mocks.replace }),
  };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }));
vi.mock('@/components/Themed', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    Button: ({ title, ...props }: { title: string }) =>
      ReactModule.createElement('Button', props, title),
    Text: host('ThemedText'),
    View: host('ThemedView'),
    useColors: () => ({
      background: '#fff',
      backgroundElevated: '#fffdf8',
      backgroundSecondary: '#f7f2e8',
      border: '#ddd',
      accent: '#b94722',
      accentSoft: '#fbe8de',
      text: '#111',
      textMuted: '#666',
      textSecondary: '#555',
      tint: '#e85d2a',
      warning: '#f4b942',
    }),
  };
});
vi.mock('@/components/RecipeVisibilitySelector', async () => {
  const ReactModule = await import('react');
  return {
    RecipeVisibilitySelector: ({ value, onChange, disabled }: {
      value: 'private' | 'public';
      onChange: (value: 'private' | 'public') => void;
      disabled?: boolean;
    }) => ReactModule.createElement(
      'NativeView',
      null,
      ReactModule.createElement('TouchableOpacity', {
        accessibilityLabel: 'Private',
        accessibilityState: { checked: value === 'private', disabled },
        onPress: () => onChange('private'),
      }),
      ReactModule.createElement('TouchableOpacity', {
        accessibilityLabel: 'Public in Discover',
        accessibilityState: { checked: value === 'public', disabled },
        onPress: () => onChange('public'),
      }),
    ),
  };
});
vi.mock('@/constants/Colors', () => ({
  fontFamily: { displaySemibold: 'Fraunces' },
  fontSize: { xs: 10, sm: 12, md: 14, lg: 18, xl: 24 },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { md: 8, lg: 12 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
}));
vi.mock('@/hooks/useRecipes', () => ({
  useSaveCapturedRecipe: () => ({ mutateAsync: mocks.save }),
}));
vi.mock('@/hooks/usePublishingDisclosure', () => ({
  usePublishingDisclosure: () => ({ requestPublishing: mocks.requestPublishing, isCheckingDisclosure: false }),
}));
vi.mock('@/lib/ocrReview', () => ({
  getOcrPublishDisclosure: () => ({
    title: 'Red Rice',
    ingredientCount: 0,
    instructionCount: 0,
    hasPhoto: false,
    hasSourceLink: false,
    contributorName: 'your contributor name',
  }),
  hasOcrNutrition: () => true,
}));
vi.mock('@/lib/recipePublishing', () => ({ formatPublishDisclosure: vi.fn(() => 'Preview') }));

import OCRReviewScreen from '../app/ocr-review';
import {offlineRecipes} from '../lib/offlineRecipes';

const warning = 'The amount for chicken was unclear. Check it before saving.';
const baseRecipe = {
  title: 'Red Rice',
  components: [],
  tags: ['Dinner'],
  nutrition: { perServing: { calories: 220 } },
};

/** Render the screen after its route payload has populated local state. */
async function renderRecipe(confidence: Record<string, unknown>): Promise<ReactTestRenderer> {
  mocks.params.recipe = JSON.stringify({ ...baseRecipe, ...confidence });
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(OCRReviewScreen));
  });
  return renderer!;
}

/** Find only host text nodes containing the conditional confidence warning. */
function confidenceWarnings(renderer: ReactTestRenderer) {
  const themedTextType = 'ThemedText' as unknown as React.ComponentType;
  return renderer.root.findAllByType(themedTextType).filter(
    (node) => node.props.children === warning,
  );
}

describe('OCRReviewScreen confidence notice', () => {
  beforeEach(() => {
    mocks.ownerId = 'owner-a'; mocks.entries = []; mocks.patchInbox.mockReset();
    mocks.patchInbox.mockImplementation(async (id: string, patch: Record<string, unknown>) => { mocks.entries = mocks.entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry); });
    mocks.alert.mockClear();
    mocks.back.mockClear();
    mocks.replace.mockClear();
    mocks.requestPublishing.mockReset();
    mocks.requestPublishing.mockResolvedValue(true);
    mocks.save.mockReset();
    mocks.save.mockImplementation(async (params) => ({ id: 'recipe-1', is_public: params.is_public }));
    mocks.params.originalPages = undefined; mocks.params.captureOwnerId = undefined;
    mocks.params.isPublic = 'false';
    mocks.params.saveFailed = undefined;
    mocks.params.saveErrorKind = undefined;
    mocks.params.saveErrorMessage = undefined;
    mocks.params.sourceType = 'photo';
  });

  it('R4 hides A OCR recipe after same-subject stable-owner retirement', async () => {
    await offlineRecipes.clear(); await offlineRecipes.bindSubject('subject'); await offlineRecipes.verify('subject','owner-a');
    mocks.params.captureOwnerId = 'owner-a';
    const renderer = await renderRecipe({title:'A private family recipe'});
    try {
      expect(JSON.stringify(renderer.toJSON())).toContain('A private family recipe');
      await act(async()=>{ await offlineRecipes.verify('subject','owner-b'); renderer.update(React.createElement(OCRReviewScreen)); });
      console.log('R4 OCR owner',offlineRecipes.lease('subject')?.owner,'still displays private title',JSON.stringify(renderer.toJSON()).includes('A private family recipe'));
      expect(JSON.stringify(renderer.toJSON())).not.toContain('A private family recipe');
    } finally { await act(async()=>renderer.unmount()); await offlineRecipes.clear(); }
  });

  it.each([
    ['the low-confidence flag is absent', { confidenceWarning: warning }],
    ['the warning is absent', { lowConfidence: true }],
  ])('hides the confidence notice when %s', async (_label, confidence) => {
    const renderer = await renderRecipe(confidence);

    expect(confidenceWarnings(renderer)).toHaveLength(0);
  });
});
