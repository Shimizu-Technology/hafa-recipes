import { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
// Expo Router vendors React Navigation's tab bar. Reuse its renderer so tab
// press, long-press, accessibility, and safe-area behavior stay unchanged.
import {
  BottomTabBar,
  type BottomTabBarProps,
} from 'expo-router/build/react-navigation/bottom-tabs';

import { AssistantDockButton } from '@/components/AssistantDockButton';
import RecipeChatModal from '@/components/RecipeChatModal';
import { useColors } from '@/components/Themed';

type Props = BottomTabBarProps & { isSignedIn: boolean };

/** Keep the chat action in layout above the tabs, never over scrolling content. */
export function AssistantTabBar({ isSignedIn, ...tabBarProps }: Props) {
  const colors = useColors();
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  const [showChat, setShowChat] = useState(false);
  const [hasOpenedChat, setHasOpenedChat] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (!isSignedIn) {
      setShowChat(false);
      setHasOpenedChat(false);
    }
  }, [isSignedIn]);

  return (
    <View style={{ backgroundColor: colors.backgroundElevated }}>
      {isSignedIn && !keyboardVisible && (
        <View style={[styles.dock, { borderTopColor: colors.border }]}>
          <AssistantDockButton onPress={() => {
            setHasOpenedChat(true);
            setShowChat(true);
          }} />
        </View>
      )}
      <BottomTabBar {...tabBarProps} />
      {isSignedIn && hasOpenedChat && (
        <RecipeChatModal isVisible={showChat} onClose={() => setShowChat(false)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
