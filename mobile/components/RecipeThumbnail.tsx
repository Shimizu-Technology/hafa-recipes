import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, View as RNView, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageErrorEventData } from 'expo-image';

import { useColors } from '@/components/Themed';

type RecipeThumbnailProps = {
  uri?: string | null;
  style: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessible?: boolean;
  placeholderIconName?: ComponentProps<typeof Ionicons>['name'];
  placeholderIconSize?: number;
  priority?: 'low' | 'normal' | 'high';
  overlay?: ReactNode;
  onError?: (error: ImageErrorEventData) => void;
};

/** Paint a placeholder immediately, then reveal a persistently cached recipe image. */
export function RecipeThumbnail({
  uri,
  style,
  accessibilityLabel = 'Recipe photo',
  accessible = true,
  placeholderIconName = 'restaurant-outline',
  placeholderIconSize = 32,
  priority = 'normal',
  overlay,
  onError,
}: RecipeThumbnailProps) {
  const colors = useColors();
  const normalizedUri = uri?.trim() || null;
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const shouldLoad = Boolean(normalizedUri && normalizedUri !== failedUri);

  useEffect(() => {
    setFailedUri(null);
  }, [normalizedUri]);

  return (
    <RNView
      style={[styles.container, { backgroundColor: `${colors.tint}15` }, style]}
      accessible={accessible}
      accessibilityRole={accessible ? 'image' : undefined}
      accessibilityLabel={accessible ? accessibilityLabel : undefined}
    >
      <Ionicons
        name={placeholderIconName}
        size={placeholderIconSize}
        color={colors.tint}
        importantForAccessibility="no-hide-descendants"
      />
      {shouldLoad && (
        <>
          <Image
            source={{ uri: normalizedUri! }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={normalizedUri}
            priority={priority}
            transition={150}
            autoplay={false}
            accessible={false}
            onError={(event) => {
              setFailedUri(normalizedUri);
              onError?.(event);
            }}
          />
          {overlay}
        </>
      )}
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
