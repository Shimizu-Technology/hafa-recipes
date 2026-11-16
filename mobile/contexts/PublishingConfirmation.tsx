import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { fontFamily } from '@/constants/Colors';

type Prompt = { message: string; label: string };
type Confirm = ((prompt: Prompt) => Promise<boolean>) & { cancel?: () => void };
type Controller = { confirm: (prompt: Prompt, consumer: symbol) => Promise<boolean>; cancel: (consumer: symbol) => void };
const Context = createContext<Controller>({ confirm: async () => false, cancel: () => {} });
export function usePublishingConfirmation(): Confirm {
  const controller = useContext(Context);
  const consumer = useRef(Symbol('publishing consumer'));
  return useMemo(() => Object.assign((prompt: Prompt) => controller.confirm(prompt, consumer.current), {
    cancel: () => controller.cancel(consumer.current),
  }), [controller]);
}
export const CONFIRMATION_TIMEOUT_MS = 120_000;

/** Mount inside the route: a root RN Modal can be covered by a native modal screen. */
export function PublishingConfirmationProvider({ children }: { children: React.ReactNode }) {
  const { colorScheme } = useTheme();
  const dark = colorScheme === 'dark';
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const pending = useRef<{ consumer: symbol; resolve: (answer: boolean) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const finish = useCallback((answer: boolean) => {
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current.resolve(answer);
      pending.current = null;
    }
    setPrompt(null);
  }, []);
  const cancel = useCallback((consumer: symbol) => {
    if (pending.current?.consumer !== consumer) return;
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current.reject(new Error('Publishing screen closed.'));
      pending.current = null;
    }
    setPrompt(null);
  }, []);
  const confirm = useCallback((next: Prompt, consumer: symbol) => new Promise<boolean>((resolve, reject) => {
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current.reject(new Error('Publishing confirmation replaced.'));
    }
    Keyboard.dismiss();
    const timer = setTimeout(() => {
      pending.current = null;
      setPrompt(null);
      reject(Object.assign(new Error('Publishing confirmation timed out. Please try again.'), { name: 'TimeoutError' }));
    }, CONFIRMATION_TIMEOUT_MS);
    pending.current = { consumer, resolve, reject, timer };
    setPrompt(next);
  }), []);
  useEffect(() => {
    if (!prompt) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { finish(false); return true; });
    return () => subscription.remove();
  }, [prompt, finish]);
  useEffect(() => () => {
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current.reject(new Error('Publishing screen closed.'));
      pending.current = null;
    }
  }, []);
  const controller = useMemo(() => ({ confirm, cancel }), [confirm, cancel]);
  return <Context.Provider value={controller}>
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }} accessibilityElementsHidden={!!prompt} importantForAccessibility={prompt ? 'no-hide-descendants' : 'auto'}>{children}</View>
      {prompt && <View testID="publishing-confirmation" accessibilityViewIsModal style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000, justifyContent: 'flex-end', backgroundColor: '#0008' }}>
        <ScrollView style={{ flexGrow: 0, maxHeight: '85%', backgroundColor: dark ? '#18221F' : '#F7F7F5', borderTopLeftRadius: 24, borderTopRightRadius: 24 }} contentContainerStyle={{ padding: 28, paddingBottom: 48, gap: 20 }}>
          <Text accessibilityRole="header" style={{ fontSize: 26, fontFamily: fontFamily.bold, color: dark ? '#F7F7F5' : '#18221F' }}>Make this recipe public?</Text>
          <Text style={{ fontSize: 17, lineHeight: 25, fontFamily: fontFamily.regular, color: dark ? '#F7F7F5' : '#18221F' }}>Anyone can find it in Discover and open its link.</Text>
          <Text style={{ fontSize: 16, lineHeight: 24, fontFamily: fontFamily.regular, color: dark ? '#D6DFDA' : '#45564F' }}>{prompt.message}</Text>
          <Pressable accessibilityRole="button" onPress={() => finish(true)} style={{ padding: 16, borderRadius: 14, backgroundColor: '#145E52' }}><Text style={{ color: '#FFF', textAlign: 'center', fontSize: 17, fontFamily: fontFamily.semibold }}>{prompt.label}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => finish(false)} style={{ padding: 16 }}><Text style={{ color: dark ? '#F7F7F5' : '#145E52', textAlign: 'center', fontSize: 17, fontFamily: fontFamily.semibold }}>Cancel · Keep private</Text></Pressable>
        </ScrollView>
      </View>}
    </View>
  </Context.Provider>;
}
