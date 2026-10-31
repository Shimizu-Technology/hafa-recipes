import { useId, useRef } from 'react';
import { Stack, useRouter } from 'expo-router';
import { View } from 'react-native';
import { AccountHeaderButton } from '@/components/TabChrome';
import { IconButton, useColors } from '@/components/Themed';

type Action = { title: string; onPress: () => void };
/** Browser-owned popover keeps the header actions usable without native Alert. */
export function RecipeBrowseHeader({ library = false, actions }: { library?: boolean; actions: Action[] }) {
  const colors = useColors();
  const router = useRouter();
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  return <Stack.Screen options={{ headerRight: () => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
    <button type="button" popoverTarget={id} aria-label={library ? 'Library options' : 'Discover options'} style={{ minWidth: 44, minHeight: 44, border: 0, background: 'transparent', color: colors.actionText, fontSize: 22, cursor: 'pointer' }}>···</button>
    <div ref={menu} id={id} popover="auto" style={{ position: 'fixed', inset: '64px 16px auto auto', margin: 0, minWidth: 220, padding: 8, border: 0, borderRadius: 12, background: colors.backgroundElevated, color: colors.text, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
      {actions.map(action => <button key={action.title} type="button" onClick={() => { menu.current?.hidePopover?.(); action.onPress(); }} style={{ display: 'block', width: '100%', minHeight: 44, padding: '8px 12px', border: 0, background: 'transparent', color: colors.text, fontFamily: 'system-ui', fontSize: 15, lineHeight: '20px', textAlign: 'left', cursor: 'pointer' }}>{action.title}</button>)}
    </div>
    {library && <IconButton icon="add" accessibilityLabel="Add a recipe" color={colors.actionText} onPress={() => router.push('/add-options')} />}
    <AccountHeaderButton />
  </View> }} />;
}
