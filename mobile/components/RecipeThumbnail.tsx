import { useRecipeOwnerGeneration } from '@/hooks/useOfflineLease';
import { offlineRecipes } from '@/lib/offlineRecipes';
import { recipeScope } from '@/lib/recipeQueryScope';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, View as RNView, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageErrorEventData } from 'expo-image';

import { Text, useColors } from '@/components/Themed';
import { useLook } from '@/contexts/LookContext';
import type { Look, LookPalette } from '@/constants/looks';

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
  /** Dish name for the designed no-photo tile in preview looks. */
  placeholderTitle?: string;
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
  placeholderTitle,
}: RecipeThumbnailProps) {
  const scope = useRecipeOwnerGeneration();
  const colors = useColors();
  const look = useLook();
  const designed = look.variants.placeholder !== 'current';
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
      style={[styles.container, { backgroundColor: designed ? colors.placeholder : `${colors.tint}15` }, style]}
      accessible={accessible}
      accessibilityRole={accessible ? 'image' : undefined}
      accessibilityLabel={accessible ? (origin.scope === scope ? accessibilityLabel : 'Recipe photo') : undefined}
    >
      {designed && placeholderTitle
        ? <PlaceholderTile look={look} colors={colors} title={placeholderTitle} />
        : <Ionicons
          name={placeholderIconName}
          size={placeholderIconSize}
          color={designed ? colors.placeholderInk : colors.actionText}
          importantForAccessibility="no-hide-descendants"
        />}
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

/**
 * The no-photo tile, designed per look so a missing cover never reads as a grey slab.
 * Cookbook sets the dish name like a cookbook plate; Island shows a Fraunces initial with a sun dot;
 * Calm shows a quiet utensil glyph over the name.
 */
function PlaceholderTile({ look, colors, title }: { look: Look; colors: LookPalette; title: string }) {
  const variant = look.variants.placeholder;
  const initial = title.trim().charAt(0).toUpperCase() || '·';
  if (variant === 'monogram') {
    return <RNView style={styles.tileFill} importantForAccessibility="no-hide-descendants">
      <RNView style={[styles.sun, { backgroundColor: colors.highlight }]} />
      <Text allowFontScaling={false} style={[styles.monogram, { color: colors.placeholderInk, fontFamily: look.fonts?.display }]}>{initial}</Text>
    </RNView>;
  }
  if (variant === 'type') {
    return <RNView style={[styles.tileFill, styles.typeTile]} importantForAccessibility="no-hide-descendants">
      <RNView style={[styles.rule, { backgroundColor: colors.placeholderInk }]} />
      <Text numberOfLines={4} allowFontScaling={false} style={[styles.typeTitle, { color: colors.placeholderInk, fontFamily: look.fonts?.display }]}>{title}</Text>
    </RNView>;
  }
  return <RNView style={[styles.tileFill, styles.quietTile]} importantForAccessibility="no-hide-descendants">
    <RNView style={[styles.quietRing, { borderColor: colors.border }]}>
      <Ionicons name="restaurant-outline" size={22} color={colors.placeholderInk} />
    </RNView>
    <Text numberOfLines={2} allowFontScaling={false} style={[styles.quietTitle, { color: colors.placeholderInk, fontFamily: look.fonts?.ui?.semibold }]}>{title}</Text>
  </RNView>;
}

const styles = StyleSheet.create({
  tileFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  sun: { position: 'absolute', top: 16, right: 16, width: 10, height: 10, borderRadius: 5 },
  monogram: { fontSize: 64, lineHeight: 72 },
  typeTile: { alignItems: 'flex-start', justifyContent: 'flex-end', padding: 14, gap: 10 },
  rule: { width: 24, height: 1.5, opacity: 0.5 },
  typeTitle: { fontSize: 20, lineHeight: 25 },
  quietTile: { gap: 10, paddingHorizontal: 16 },
  quietRing: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  quietTitle: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
