import { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
// Expo Router vendors React Navigation's tab bar. Reuse its renderer so tab
// press, long-press, accessibility, and safe-area behavior stay unchanged.
import {
  BottomTabBar,
  type BottomTabBarProps,
} from 'expo-router/build/react-navigation/bottom-tabs';

import { AssistantFloatingButton } from '@/components/AssistantFloatingButton';
import RecipeChatModal from '@/components/RecipeChatModal';
import { useColors } from '@/components/Themed';

type Props = BottomTabBarProps & { isSignedIn: boolean };

/** Float the chat action above the tabs without adding a permanent dock row. */
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
    <View style={{ backgroundColor: colors.backgroundElevated, overflow: 'visible' }}>
      <BottomTabBar {...tabBarProps} />
      {isSignedIn && !keyboardVisible && (
        <View style={styles.floatingAction}>
          <AssistantFloatingButton onPress={() => {
            setHasOpenedChat(true);
            setShowChat(true);
          }} />
        </View>
      )}
      {isSignedIn && hasOpenedChat && (
        <RecipeChatModal isVisible={showChat} onClose={() => setShowChat(false)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  floatingAction: {
    position: 'absolute',
    bottom: '100%',
    right: 16,
    marginBottom: 12,
    zIndex: 1,
  },
});
