import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean; __DEV__: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as typeof globalThis & { __DEV__: boolean }).__DEV__ = false;

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  appStateListeners: [] as ((state: string) => void)[],
  vibrate: vi.fn(),
  impact: vi.fn(async (_style: string) => undefined),
  notification: vi.fn(async () => undefined),
  play: vi.fn(),
  seekTo: vi.fn(async () => undefined),
  hasScheduledNotification: vi.fn((_stepIndex: number) => false),
  scheduleTimerNotification: vi.fn(async () => undefined),
  back: vi.fn(),
  recipeQuery: {
    data: undefined as unknown,
    isLoading: false,
    error: null as unknown,
  },
}));

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  class AnimatedValue {
    constructor(public value: number) {}
    setValue(value: number) { this.value = value; }
  }
  const instant = () => ({ start: (done?: () => void) => done?.() });
  return {
    Animated: { View: host('AnimatedView'), Value: AnimatedValue, timing: instant, parallel: instant },
    AppState: {
      currentState: 'active',
      addEventListener: (_event: string, listener: (state: string) => void) => {
        mocks.appStateListeners.push(listener);
        return { remove: () => {
          mocks.appStateListeners = mocks.appStateListeners.filter((l) => l !== listener);
        } };
      },
    },
    Dimensions: { get: () => ({ width: 400, height: 800 }) },
    KeyboardAvoidingView: host('KeyboardAvoidingView'),
    Modal: host('Modal'),
    Platform: { OS: 'ios' },
    ScrollView: host('ScrollView'),
    StatusBar: host('StatusBar'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    TextInput: host('TextInput'),
    TouchableOpacity: host('TouchableOpacity'),
    Vibration: { vibrate: mocks.vibrate },
    View: host('NativeView'),
  };
});
vi.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' },
  NotificationFeedbackType: { Success: 'Success', Warning: 'Warning', Error: 'Error' },
  impactAsync: mocks.impact,
  notificationAsync: mocks.notification,
  selectionAsync: vi.fn(),
}));
vi.mock('expo-audio', () => ({
  createAudioPlayer: () => ({ play: mocks.play, seekTo: mocks.seekTo, remove: vi.fn() }),
}));
vi.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: vi.fn(), deactivateKeepAwake: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mocks.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { mocks.storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { mocks.storage.delete(key); }),
  },
}));
vi.mock('expo-router', () => {
  const Stack = () => null;
  Stack.Screen = () => null;
  return {
    Stack,
    useLocalSearchParams: () => ({ id: 'recipe-1' }),
    useRouter: () => ({ back: mocks.back }),
  };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }));
vi.mock('@/components/Themed', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  return { Text: host('ThemedText'), View: host('ThemedView'), useColors: () => ({ warning: '#f90' }) };
});
vi.mock('@/constants/Colors', () => ({
  brand: { reefHighlight: '#0aa' },
  fontSize: { xs: 11, sm: 13, md: 15, lg: 18, xl: 20, xxl: 24 },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { sm: 4, md: 14, lg: 20, xl: 28, full: 9999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
}));
vi.mock('@/hooks/useRecipes', () => ({ useRecipe: () => mocks.recipeQuery }));
vi.mock('@/hooks/useTimerSound', () => ({
  useTimerSoundPreference: () => ({ soundPreference: 'default' }),
  getTimerSoundFile: () => 'timer.mp3',
}));
vi.mock('@/hooks/useBackgroundTimer', () => ({
  useBackgroundTimer: () => ({
    scheduleTimerNotification: mocks.scheduleTimerNotification,
    cancelTimerNotification: vi.fn(async () => undefined),
    cancelAllTimerNotifications: vi.fn(async () => undefined),
    pauseTimerNotification: vi.fn(async () => undefined),
    resumeTimerNotification: vi.fn(async () => undefined),
    hasScheduledNotification: mocks.hasScheduledNotification,
  }),
}));
vi.mock('@/hooks/useTextSize', () => ({ useTextSize: () => ({ scaleFontSize: (n: number) => n }) }));
vi.mock('@/contexts/TimerContext', () => {
  const context = {
    session: null,
    timers: new Map(),
    startSession: vi.fn(),
    updateSession: vi.fn(),
    syncTimers: vi.fn(),
    endSession: vi.fn(),
  };
  return { useTimerContext: () => context };
});
vi.mock('@/components/CookIngredientsList', () => ({ CookIngredientsList: () => null }));

import CookModeScreen from '../app/cook-mode/[id]';

const RECIPE = {
  id: 'recipe-1',
  extracted: {
    title: 'Red Rice',
    components: [{
      name: 'Main',
      ingredients: [],
      steps: ['Rinse the rice.', 'Simmer for 1 minute.', 'Rest the rice.', 'Serve.'],
    }],
  },
};

const STEP_KEY = 'cook_mode_step_recipe-1';

function textOf(node: ReactTestInstance | string | number): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return node.children.map(textOf).join('');
}

function stepCounter(renderer: ReactTestRenderer): string {
  return renderer.root.findAllByType('ThemedText' as unknown as React.ComponentType)
    .map(textOf)
    .find((text) => /^Step \d+ of \d+$/.test(text))!;
}

function buttons(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType('TouchableOpacity' as unknown as React.ComponentType);
}

function buttonByLabel(renderer: ReactTestRenderer, label: string) {
  return buttons(renderer).find((node) => node.props.accessibilityLabel === label)!;
}

function buttonByText(renderer: ReactTestRenderer, text: string) {
  return buttons(renderer).find((node) => textOf(node) === text)!;
}

/** Heavy impact is only used for timer completion in cook mode. */
function completionHaptics() {
  return mocks.impact.mock.calls.filter(([style]) => style === 'Heavy').length;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(<CookModeScreen />);
  });
  await flush();
  return renderer!;
}

/** Open cook mode on the timed step (index 1) via the saved-step restore. */
async function renderOnTimedStep() {
  mocks.storage.set(STEP_KEY, '1');
  const renderer = await renderScreen();
  expect(stepCounter(renderer)).toBe('Step 2 of 4');
  await act(async () => buttonByText(renderer, 'Start 1 min timer').props.onPress());
  expect(mocks.scheduleTimerNotification).toHaveBeenCalledWith(1, 60, 'Simmer for 1 minute.', 'default');
  return renderer;
}

async function advance(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); });
}

describe('CookModeScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-01-01T12:00:00Z') });
    mocks.storage.clear();
    mocks.appStateListeners = [];
    mocks.recipeQuery.data = RECIPE;
    mocks.recipeQuery.isLoading = false;
    mocks.recipeQuery.error = null;
    mocks.hasScheduledNotification.mockReset();
    mocks.hasScheduledNotification.mockReturnValue(false);
    mocks.vibrate.mockClear();
    mocks.impact.mockClear();
    mocks.notification.mockClear();
    mocks.play.mockClear();
    mocks.seekTo.mockClear();
    mocks.scheduleTimerNotification.mockClear();
    mocks.back.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('timer completion', () => {
    it('alerts exactly once when a foreground timer finishes', async () => {
      const renderer = await renderOnTimedStep();

      await advance(59_000);
      expect(mocks.vibrate).not.toHaveBeenCalled();

      await advance(1_000);
      await flush();
      expect(textOf(renderer.root)).toContain('Timer Done!');
      expect(completionHaptics()).toBe(1);
      expect(mocks.vibrate).toHaveBeenCalledOnce();
      expect(mocks.vibrate).toHaveBeenCalledWith([0, 500, 200, 500, 200, 500]);
      expect(mocks.seekTo).toHaveBeenCalledWith(0);
      expect(mocks.play).toHaveBeenCalledOnce();

      // Further ticks and re-renders must not replay the alert.
      await advance(10_000);
      await act(async () => buttonByLabel(renderer, 'Show ingredients').props.onPress());
      await flush();
      expect(completionHaptics()).toBe(1);
      expect(mocks.vibrate).toHaveBeenCalledOnce();
      expect(mocks.play).toHaveBeenCalledOnce();
    });

    it('does not double-alert a timer that finished in the background with a scheduled notification', async () => {
      mocks.hasScheduledNotification.mockReturnValue(true);
      await renderOnTimedStep();

      await act(async () => mocks.appStateListeners.forEach((listener) => listener('background')));
      await advance(90_000);
      await act(async () => mocks.appStateListeners.forEach((listener) => listener('active')));
      await advance(2_000);
      await flush();

      expect(mocks.hasScheduledNotification).toHaveBeenCalledWith(1);
      expect(completionHaptics()).toBe(0);
      expect(mocks.vibrate).not.toHaveBeenCalled();
      expect(mocks.play).not.toHaveBeenCalled();
    });

    it('still alerts in-app for a background-finished timer when no notification was scheduled', async () => {
      mocks.hasScheduledNotification.mockReturnValue(false);
      await renderOnTimedStep();

      await act(async () => mocks.appStateListeners.forEach((listener) => listener('background')));
      await advance(90_000);
      await act(async () => mocks.appStateListeners.forEach((listener) => listener('active')));
      await flush();

      expect(completionHaptics()).toBe(1);
      expect(mocks.vibrate).toHaveBeenCalledOnce();
      expect(mocks.play).toHaveBeenCalledOnce();
    });
  });

  describe('saved step', () => {
    it('resumes a cold open at the saved step instead of overwriting it with step 0', async () => {
      mocks.storage.set(STEP_KEY, '2');
      mocks.recipeQuery.data = undefined;
      mocks.recipeQuery.isLoading = true;
      let renderer: ReactTestRenderer;
      await act(async () => {
        renderer = create(<CookModeScreen />);
      });
      await flush();
      // Still loading: progress must not have been reset.
      expect(mocks.storage.get(STEP_KEY)).toBe('2');

      mocks.recipeQuery.data = RECIPE;
      mocks.recipeQuery.isLoading = false;
      await act(async () => renderer!.update(<CookModeScreen />));
      await flush();

      expect(stepCounter(renderer!)).toBe('Step 3 of 4');
      expect(mocks.storage.get(STEP_KEY)).toBe('2');
    });
  });

  describe('accessibility', () => {
    it('labels the header and navigation controls and reflects the disabled state', async () => {
      const renderer = await renderScreen();

      for (const label of ['Exit cook mode', 'Show ingredients', 'Previous step', 'Next step']) {
        expect(buttonByLabel(renderer, label).props.accessibilityRole).toBe('button');
      }
      expect(buttonByLabel(renderer, 'Previous step').props.disabled).toBe(true);
      expect(buttonByLabel(renderer, 'Previous step').props.accessibilityState).toEqual({ disabled: true });

      await act(async () => buttonByLabel(renderer, 'Exit cook mode').props.onPress());
      expect(mocks.back).toHaveBeenCalledOnce();
    });

    it('enables Previous after the first step and labels the last step action as Finish', async () => {
      mocks.storage.set(STEP_KEY, '3');
      const renderer = await renderScreen();

      expect(stepCounter(renderer)).toBe('Step 4 of 4');
      expect(buttonByLabel(renderer, 'Previous step').props.accessibilityState).toEqual({ disabled: false });
      expect(buttonByLabel(renderer, 'Next step')).toBeUndefined();
      const finish = buttonByLabel(renderer, 'Finish recipe');
      expect(finish.props.accessibilityRole).toBe('button');

      await act(async () => finish.props.onPress());
      const done = buttonByText(renderer, 'Done Cooking');
      expect(done.props.accessibilityRole).toBe('button');
    });

    it('opens and closes the ingredients sheet through labelled buttons', async () => {
      const renderer = await renderScreen();
      const ingredientsModal = () => renderer.root.findAllByType('Modal' as unknown as React.ComponentType)
        .find((modal) => textOf(modal).includes('Ingredients'))!;

      expect(ingredientsModal().props.visible).toBe(false);
      await act(async () => buttonByLabel(renderer, 'Show ingredients').props.onPress());
      expect(ingredientsModal().props.visible).toBe(true);
      await act(async () => buttonByLabel(renderer, 'Close ingredients').props.onPress());
      expect(ingredientsModal().props.visible).toBe(false);
    });
  });
});
