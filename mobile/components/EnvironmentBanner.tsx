import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { APP_ENVIRONMENT, ENVIRONMENT_LABEL } from '@/lib/apiConfig';

export function EnvironmentBanner() {
  const insets = useSafeAreaInsets();
  if (!ENVIRONMENT_LABEL) return null;

  return (
    <View
      accessible
      accessibilityLabel={`Non-production environment: ${ENVIRONMENT_LABEL}`}
      pointerEvents="none"
      style={[
        styles.banner,
        {
          paddingTop: insets.top,
          backgroundColor: APP_ENVIRONMENT === 'preview' ? '#7C3AED' : '#9A3412',
        },
      ]}
    >
      <Text style={styles.label}>{ENVIRONMENT_LABEL}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 900,
    alignItems: 'center',
    paddingBottom: 3,
    paddingHorizontal: 12,
  },
  label: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
});
