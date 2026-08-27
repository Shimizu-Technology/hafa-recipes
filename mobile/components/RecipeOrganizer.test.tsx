import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  Platform: { OS: 'ios' },
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  Text: 'Text',
  View: 'ThemedView',
  useColors: () => ({
    background: '#fff',
    backgroundSecondary: '#eee',
    border: '#ddd',
    card: '#fff',
    text: '#111',
    textMuted: '#666',
    textSecondary: '#333',
    tint: '#155C52',
  }),
}));
vi.mock('@/constants/Colors', () => ({
  fontFamily: { display: 'Fraunces', semibold: 'DMSans_600SemiBold' },
  fontSize: { xs: 11, sm: 13, md: 15, xl: 24 },
  fontWeight: { medium: '500', semibold: '600' },
  radius: { md: 12, lg: 16, full: 999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
}));
vi.mock('./RecipeCollectionsCard', () => ({ RecipeCollectionsCard: 'RecipeCollectionsCard' }));
vi.mock('./RecipeMealPlanCard', () => ({
  RecipeMealPlanCard: 'RecipeMealPlanCard',
  formatMealPlanDate: () => 'Sat, Aug 29',
}));

import { RecipeOrganizer } from './RecipeOrganizer';

/** Build isolated organizer props with spies that each test can inspect. */
function organizerProps() {
  return {
    recipeTitle: 'Chicken Kelaguen',
    collections: [{
      id: 'favorites',
      name: 'Favorites',
      emoji: null,
      recipe_count: 1,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
    }],
    areCollectionsLoading: false,
    onOpenCollection: vi.fn(),
    onManageCollections: vi.fn(),
    planEntries: [{
      id: 'plan-1',
      recipe_id: 'recipe-1',
      recipe_title: 'Chicken Kelaguen',
      recipe_thumbnail: null,
      date: '2026-08-29',
      meal_type: 'dinner' as const,
      notes: null,
      servings: null,
      created_at: '2026-08-01T00:00:00Z',
    }],
    isPlanLoading: false,
    hasPlanError: false,
    isPlanRetrying: false,
    onOpenPlanDate: vi.fn(),
    onPlanRecipe: vi.fn(),
    onRetryPlan: vi.fn(),
    savedNote: 'Add more lemon next time.',
    isNoteLoading: false,
    isNoteSaving: false,
    onSaveNote: vi.fn().mockResolvedValue(undefined),
  };
}

describe('RecipeOrganizer', () => {
  it('summarizes all three private tools without expanding them inline', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(React.createElement(RecipeOrganizer, organizerProps())));

      for (const label of [
        'Open Collections. 1 collection',
        'Open Plan. Sat, Aug 29',
        'Open Notes. Private note',
      ]) {
        expect(renderer.container.queryAll(
          (instance) => instance.props.accessibilityLabel === label,
        )).toHaveLength(1);
      }
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'RecipeCollectionsCard'
          || instance.type === 'RecipeMealPlanCard',
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('opens connected collection details and closes before following a link', async () => {
    const props = organizerProps();
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(React.createElement(RecipeOrganizer, props)));
      const openCollections = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Open Collections. 1 collection',
      )[0];
      await act(async () => openCollections.props.onPress());

      const card = renderer.container.queryAll(
        (instance) => instance.type === 'RecipeCollectionsCard',
      )[0];
      await act(async () => card.props.onOpenCollection('favorites'));
      expect(props.onOpenCollection).toHaveBeenCalledWith('favorites');
      expect(renderer.container.queryAll((instance) => instance.type === 'Modal')[0].props.visible).toBe(false);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('edits and saves a trimmed private note inside the sheet', async () => {
    const props = organizerProps();
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(React.createElement(RecipeOrganizer, props)));
      const openNotes = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Open Notes. Private note',
      )[0];
      await act(async () => openNotes.props.onPress());
      const editNote = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Edit private recipe note',
      )[0];
      await act(async () => editNote.props.onPress());

      const input = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Private recipe note',
      )[0];
      await act(async () => input.props.onChangeText('  Use calamansi instead.  '));
      const save = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Save private recipe note',
      )[0];
      await act(async () => save.props.onPress());

      expect(props.onSaveNote).toHaveBeenCalledWith('Use calamansi instead.');
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Private recipe note',
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('keeps an unsaved draft open when saving fails', async () => {
    const props = organizerProps();
    props.onSaveNote.mockRejectedValueOnce(new Error('Network unavailable'));
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(React.createElement(RecipeOrganizer, props)));
      const openNotes = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Open Notes. Private note',
      )[0];
      await act(async () => openNotes.props.onPress());
      const editNote = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Edit private recipe note',
      )[0];
      await act(async () => editNote.props.onPress());

      const input = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Private recipe note',
      )[0];
      await act(async () => input.props.onChangeText('Keep this draft'));
      const save = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Save private recipe note',
      )[0];
      await act(async () => save.props.onPress());

      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Private recipe note',
      )[0].props.value).toBe('Keep this draft');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('locks draft and dismissal controls until a save finishes', async () => {
    const props = organizerProps();
    let finishSave: (() => void) | undefined;
    props.onSaveNote.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishSave = resolve;
    }));
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(React.createElement(RecipeOrganizer, props)));
      await act(async () => renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Open Notes. Private note',
      )[0].props.onPress());
      await act(async () => renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Edit private recipe note',
      )[0].props.onPress());

      const save = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Save private recipe note',
      )[0];
      await act(async () => {
        void save.props.onPress();
        await Promise.resolve();
      });

      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Private recipe note',
      )[0].props.editable).toBe(false);
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Cancel note editing',
      )[0].props.disabled).toBe(true);
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Close recipe organizer',
      )[0].props.disabled).toBe(true);

      await act(async () => {
        finishSave?.();
        await Promise.resolve();
      });
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});
