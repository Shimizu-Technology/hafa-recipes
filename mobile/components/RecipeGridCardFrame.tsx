import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View as RNView } from 'react-native';

import { ScalePressable } from '@/components/Animated';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import { Text, useColors } from '@/components/Themed';
import { fontFamily, fontSize, radius, spacing } from '@/constants/Colors';

export const RECIPE_GRID_GAP = spacing.sm;

type RecipeGridCardFrameProps = {
  title: string;
  thumbnailUrl?: string | null;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  footer: ReactNode;
  imageAdornment?: ReactNode;
  imagePriority?: 'normal' | 'high';
  /** VoiceOver label for the whole card; defaults to the title. */
  accessibilityLabel?: string;
  /** Selection state while the surrounding list is in multi-select mode. */
  selected?: boolean;
};

/** Keep the image, two-line title slot, and footer aligned across recipe grids. */
export function RecipeGridCardFrame({
  title,
  thumbnailUrl,
  onPress,
  colors,
  footer,
  imageAdornment,
  imagePriority = 'normal',
  accessibilityLabel,
  selected,
}: RecipeGridCardFrameProps) {
  const { width, fontScale } = useWindowDimensions();
  const titleSlotHeight = Math.ceil(42 * fontScale);
  const footerHeight = Math.ceil(18 * fontScale);
  const cardWidth = fontScale >= 1.3
    ? width - spacing.lg * 2
    : (width - spacing.lg * 2 - RECIPE_GRID_GAP) / 2;

  return (
    <ScalePressable
      style={[styles.card, { width: cardWidth, backgroundColor: colors.card, borderColor: colors.cardBorder }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={selected === undefined ? undefined : { selected }}
    >
      <RNView style={styles.imageContainer}>
        <RecipeThumbnail
          uri={thumbnailUrl}
          style={styles.image}
          accessibilityLabel={`${title} photo`}
          placeholderIconSize={40}
          priority={imagePriority}
        />
        {imageAdornment}
      </RNView>
      <RNView style={[styles.content, { minHeight: spacing.sm * 2 + titleSlotHeight + footerHeight + 12 }]}>
        <Text
          style={[styles.title, { color: colors.text, minHeight: titleSlotHeight }]}
          numberOfLines={2}
        >
          {title}
        </Text>
        <RNView style={[styles.footer, { minHeight: footerHeight }]}>{footer}</RNView>
      </RNView>
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    borderWidth: 1,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 1,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  content: {
    padding: spacing.sm,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 16,
    fontFamily: fontFamily.displaySemibold, fontWeight: '600',
    lineHeight: 21,
  },
  footer: {
    justifyContent: 'flex-end',
  },
});
