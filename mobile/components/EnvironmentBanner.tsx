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
          paddingTop: Math.max(0, insets.top - 16),
          backgroundColor: APP_ENVIRONMENT === 'preview' ? '#7C3AED' : '#9A3412',
        },
      ]}
    >
      <Text allowFontScaling={false} style={styles.label}>{APP_ENVIRONMENT === 'preview' ? 'PREVIEW' : 'DEVELOPMENT'}</Text>
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
    alignItems: 'flex-start',
    paddingBottom: 3,
    paddingHorizontal: 16,
  },
  label: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
});
