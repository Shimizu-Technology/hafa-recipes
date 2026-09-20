import { StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, useColors } from '@/components/Themed';
import { fontFamily, radius } from '@/constants/Colors';
import { haptics } from '@/utils/haptics';

/** A visible, labeled cooking-chat entry point in the reserved tab-bar dock. */
export function AssistantDockButton({ onPress }: { onPress: () => void }) {
  const colors = useColors();

  return (
    <TouchableOpacity
      style={[styles.button, { backgroundColor: colors.tint }]}
      onPress={() => {
        haptics.medium();
        onPress();
      }}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="Ask Håfa"
      accessibilityHint="Opens the cooking assistant chat"
    >
      <Ionicons name="chatbubble-ellipses-outline" size={20} color="#FFFFFF" />
      <Text style={styles.label}>Ask Håfa</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    minWidth: 44,
    borderRadius: radius.full,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: {
    color: '#FFFFFF',
    fontFamily: fontFamily.semibold,
    fontSize: 14,
  },
});
