import { useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import RecipeChatModal from '@/components/RecipeChatModal';
import { useColors } from '@/components/Themed';
import { radius } from '@/constants/Colors';
import { haptics } from '@/utils/haptics';

/** Keep cooking help available on every main tab without obscuring its content. */
export function AssistantHeaderButton() {
  const colors = useColors();
  const [showChat, setShowChat] = useState(false);
  const [hasOpenedChat, setHasOpenedChat] = useState(false);

  return (
    <>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.tint }]}
        onPress={() => {
          haptics.medium();
          setHasOpenedChat(true);
          setShowChat(true);
        }}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Ask Håfa cooking assistant"
        accessibilityHint="Opens cooking help"
      >
        <Ionicons name="sparkles" size={20} color="#FFFFFF" />
      </TouchableOpacity>
      {hasOpenedChat && <RecipeChatModal isVisible={showChat} onClose={() => setShowChat(false)} />}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
