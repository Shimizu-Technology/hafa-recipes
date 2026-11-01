import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSegments } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AskHafaPill } from '@/components/AssistantFloatingButton';
import RecipeChatModal from '@/components/RecipeChatModal';
import { TAB_BAR_HEIGHT, useKeyboardVisible } from '@/components/chrome/HafaTabBar';
import { useCookTimerRunning } from '@/contexts/CookTimerRunning';
import { DOCKED_TIMER_HEIGHT, OVERLAY_GAP } from '@/lib/bottomOverlay';
import { setAskPillCollapsed, showsAskPill, useAskPillCollapsed } from '@/lib/askPill';

/**
 * General Ask Håfa, floating 12pt above the tab bar on Library, Discover and Plan.
 * It is a sibling of the tabs (not a child of the bar) so Android delivers its touches.
 */
export function AskHafaFloating() {
  const { isSignedIn } = useAuth();
  const segments = useSegments();
  const { bottom } = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const collapsed = useAskPillCollapsed();
  const timerRunning = useCookTimerRunning();
  const [showChat, setShowChat] = useState(false);
  const [hasOpenedChat, setHasOpenedChat] = useState(false);
  const tab = segments[1];
  // Each tab starts with the full label.
  useEffect(() => { setAskPillCollapsed(false); }, [tab]);
  // A signed-out device keeps no chat open from the previous account.
  useEffect(() => { if (!isSignedIn) { setShowChat(false); setHasOpenedChat(false); } }, [isSignedIn]);
  const visible = showsAskPill(segments, Boolean(isSignedIn)) && !keyboardVisible;
  // The docked cook timer takes the row just above the bar; the pill sits over it.
  const lift = TAB_BAR_HEIGHT + bottom + OVERLAY_GAP + (timerRunning ? DOCKED_TIMER_HEIGHT + OVERLAY_GAP : 0);
  return <>
    {visible && <View pointerEvents="box-none" style={[styles.anchor, { bottom: lift }]}>
      <AskHafaPill collapsed={collapsed} onPress={() => { setHasOpenedChat(true); setShowChat(true); }} />
    </View>}
    {isSignedIn && hasOpenedChat && <RecipeChatModal isVisible={showChat} onClose={() => setShowChat(false)} />}
  </>;
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', right: 16 },
});
