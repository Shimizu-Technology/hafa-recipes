import { StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useColors } from '@/components/Themed';
import { radius } from '@/constants/Colors';
import { haptics } from '@/utils/haptics';

/** Compact chat entry point above the tabs without reserving a full-width row. */
export function AssistantFloatingButton({ onPress }: { onPress: () => void }) {
  const colors = useColors();

  return (
    <TouchableOpacity
      style={[styles.button, {
        backgroundColor: colors.tint,
        borderColor: colors.backgroundElevated,
        shadowColor: colors.shadowColor,
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
      <Ionicons name="chatbubble-ellipses" size={26} color="#FFFFFF" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 54,
    height: 54,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.24,
    shadowRadius: 8,
    elevation: 6,
  },
});
