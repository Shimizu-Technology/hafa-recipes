import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';

type Prompt = { message: string; label: string };
const Context = createContext<(prompt: Prompt) => Promise<boolean>>(async () => false);
export const usePublishingConfirmation = () => useContext(Context);

export function PublishingConfirmationProvider({ children }: { children: React.ReactNode }) {
  const { colorScheme } = useTheme();
  const dark = colorScheme === 'dark';
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const pending = useRef<((answer: boolean) => void) | null>(null);
  const finish = useCallback((answer: boolean) => {
    pending.current?.(answer);
    pending.current = null;
    setPrompt(null);
  }, []);
  const confirm = useCallback((next: Prompt) => new Promise<boolean>(resolve => {
    pending.current?.(false);
    pending.current = resolve;
    setPrompt(next);
  }), []);
  useEffect(() => () => { pending.current?.(false); }, []);
  return <Context.Provider value={confirm}>
    {children}
    <Modal visible={!!prompt} transparent animationType="slide" onRequestClose={() => finish(false)}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' }}>
        <ScrollView accessibilityViewIsModal style={{ maxHeight: '85%', backgroundColor: dark ? '#18221F' : '#F7F7F5', borderTopLeftRadius: 24, borderTopRightRadius: 24 }} contentContainerStyle={{ padding: 28, paddingBottom: 48, gap: 20 }}>
          <Text accessibilityRole="header" style={{ fontSize: 26, fontFamily: 'Fraunces_600SemiBold', color: dark ? '#F7F7F5' : '#18221F' }}>Make this recipe public?</Text>
          <Text style={{ fontSize: 17, lineHeight: 25, color: dark ? '#F7F7F5' : '#18221F' }}>Anyone can find it in Discover and open its link.</Text>
          <Text style={{ fontSize: 16, lineHeight: 24, color: dark ? '#D6DFDA' : '#45564F' }}>{prompt?.message}</Text>
          <Pressable accessibilityRole="button" onPress={() => finish(true)} style={{ padding: 16, borderRadius: 14, backgroundColor: '#145E52' }}><Text style={{ color: '#FFF', textAlign: 'center', fontSize: 17 }}>{prompt?.label}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => finish(false)} style={{ padding: 16 }}><Text style={{ color: dark ? '#F7F7F5' : '#145E52', textAlign: 'center', fontSize: 17 }}>Cancel · Keep private</Text></Pressable>
        </ScrollView>
      </View>
    </Modal>
  </Context.Provider>;
}
