import { StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useColors } from '@/components/Themed';
import { radius } from '@/constants/Colors';
import { haptics } from '@/utils/haptics';

/** Quiet chat entry point above the tabs without reserving a full-width row. */
export function AssistantFloatingButton({ onPress }: { onPress: () => void }) {
  const colors = useColors();

  return (
    <TouchableOpacity
      style={[styles.button, {
        backgroundColor: colors.backgroundElevated,
        borderColor: colors.border,
      }]}
      onPress={() => {
        haptics.medium();
        onPress();
      }}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="Ask Håfa"
      accessibilityHint="Opens the cooking assistant chat"
    >
      <Ionicons name="chatbubble-ellipses" size={22} color={colors.actionText} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // A quiet surface button: it should be findable without competing with the
  // filled Import tab. The light shadow only lifts it off scrolling content.
  button: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
});
