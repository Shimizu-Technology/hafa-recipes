import { useRecipeOwnerGeneration } from '@/hooks/useOfflineLease';
import { offlineRecipes } from '@/lib/offlineRecipes';
import { recipeScope } from '@/lib/recipeQueryScope';
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

// Clear legacy shared cache entries; new requests never persist private bytes.
offlineRecipes.onRetire(() => {
  void Image.clearMemoryCache?.().catch(() => undefined);
  void Image.clearDiskCache?.().catch(() => undefined);
});

/** Paint a placeholder immediately, then reveal an authority-bound image. */
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
  const scope = useRecipeOwnerGeneration();
  const colors = useColors();
  const normalizedUri = uri?.trim() || null;
  const [origin, setOrigin] = useState({ uri: normalizedUri, scope });
  if (origin.uri !== normalizedUri) setOrigin({ uri: normalizedUri, scope });
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const shouldLoad = Boolean(origin.scope === scope && normalizedUri && normalizedUri !== failedUri);

  useEffect(() => {
    setFailedUri(null);
  }, [normalizedUri]);

  return (
    <RNView
      style={[styles.container, { backgroundColor: `${colors.tint}15` }, style]}
      accessible={accessible}
      accessibilityRole={accessible ? 'image' : undefined}
      accessibilityLabel={accessible ? (origin.scope === scope ? accessibilityLabel : 'Recipe photo') : undefined}
    >
      <Ionicons
        name={placeholderIconName}
        size={placeholderIconSize}
        color={colors.actionText}
        importantForAccessibility="no-hide-descendants"
      />
      {shouldLoad && (
        <>
          <Image
            key={scope}
            source={{ uri: normalizedUri! }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="none"
            recyclingKey={normalizedUri}
            priority={priority}
            transition={150}
            autoplay={false}
            accessible={false}
            onError={(event) => {
              if (scope !== recipeScope()) return;
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
