import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  signedIn: true,
  alert: vi.fn(),
  push: vi.fn(),
  write: vi.fn(async () => undefined),
  copy: vi.fn(),
  scope: 'personal' as 'personal' | 'household',
  items: [] as Array<Record<string, unknown>>,
  personalItems: [] as Array<Record<string, unknown>>,
  copiedIds: [] as string[],
  revision: 4,
}));

const host = vi.hoisted(() => (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode));
vi.mock('react-native', () => ({
  ActivityIndicator: host('ActivityIndicator'),
  Alert: { alert: mocks.alert },
  KeyboardAvoidingView: host('KeyboardAvoidingView'),
  Modal: host('Modal'),
  Platform: { OS: 'ios' },
  ScrollView: host('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  TextInput: host('TextInput'),
  TouchableOpacity: host('TouchableOpacity'),
  View: host('View'),
}));
vi.mock('expo-router', () => {
  const Stack = () => null;
  Stack.Screen = () => null;
  return { Stack, useRouter: () => ({ push: mocks.push }) };
});
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: mocks.signedIn }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: host('Ionicons') }));
vi.mock('@/components/Themed', () => ({ Text: host('Text'), useColors: () => ({
  background: '#fff', backgroundSecondary: '#eee', border: '#ccc', card: '#fff', cardBorder: '#ddd',
  text: '#111', textSecondary: '#444', textMuted: '#666', tint: '#165', warning: '#a61', success: '#080',
}) }));
vi.mock('@/constants/Colors', () => ({
  fontSize: { sm: 12, md: 14, lg: 18, xxl: 24 },
  fontWeight: { semibold: '600', bold: '700' },
  radius: { md: 8, lg: 12 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
}));
vi.mock('@/lib/routes', () => ({ appRoutes: { ingredientSearch: '/ingredient-search' } }));
vi.mock('@/hooks/usePantry', () => ({
  usePantrySnapshot: (scope: 'active' | 'personal') => ({
    data: scope === 'active'
      ? { scope: mocks.scope, space_id: 'space-1', revision: mocks.revision, items: mocks.items, copied_personal_item_ids: mocks.copiedIds }
      : { scope: 'personal', items: mocks.personalItems },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePantryWrite: () => ({ isPending: false, mutateAsync: mocks.write, mutate: vi.fn() }),
  useCopyPersonalPantry: () => ({ isPending: false, mutate: mocks.copy }),
}));

vi.mock('@react-native-async-storage/async-storage',()=>{const data=new Map<string,string>();return {default:{getItem:async(k:string)=>data.get(k)??null,setItem:async(k:string,v:string)=>{data.set(k,v)},getAllKeys:async()=>[...data.keys()],multiRemove:async(ks:string[])=>{ks.forEach(k=>data.delete(k))}}};});
import {offlineRecipes} from '../lib/offlineRecipes';
import PantryScreen from '../app/pantry';

function findAction(renderer: ReturnType<typeof createRoot>, label: string) {
  return renderer.container.queryAll((node) => node.type === 'TouchableOpacity' && node.props.accessibilityLabel === label)[0];
}

describe('PantryScreen', () => {
  beforeEach(() => {
    mocks.signedIn = true;
    mocks.scope = 'personal';
    mocks.items = [];
    mocks.personalItems = [];
    mocks.copiedIds = [];
    mocks.revision = 4;
    mocks.alert.mockReset();
    mocks.push.mockReset();
    mocks.write.mockReset();
    mocks.write.mockResolvedValue(undefined);
    mocks.copy.mockReset();
  });

  it('R4 retires A quick-add text before B can submit it', async () => {
    await offlineRecipes.clear(); await offlineRecipes.bindSubject('subject'); await offlineRecipes.verify('subject','owner-a');
    const renderer=createRoot();
    try {
      await act(async()=>renderer.render(React.createElement(PantryScreen)));
      let input=renderer.container.queryAll(node=>node.props.accessibilityLabel==='Pantry items to add')[0];
      await act(async()=>input.props.onChangeText('A private ingredient'));
      // Same subject remains signed in; fresh B query/mutation hooks replace A's.
      mocks.items=[]; mocks.revision=1; await offlineRecipes.verify('subject','owner-b');
      await act(async()=>renderer.render(React.createElement(PantryScreen)));
      input=renderer.container.queryAll(node=>node.props.accessibilityLabel==='Pantry items to add')[0];
      console.log('R4 B pantry retained input',input.props.value);
      await act(async()=>findAction(renderer,'Add pantry items').props.onPress());
      console.log('R4 new-owner pantry mutation inputs',mocks.write.mock.calls);
      expect.soft(input.props.value).toBe('');
      expect(mocks.write).not.toHaveBeenCalled();
    }finally{await act(async()=>renderer.unmount()); await offlineRecipes.clear();}
  });
});
