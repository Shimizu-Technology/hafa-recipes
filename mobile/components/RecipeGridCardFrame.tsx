import type { ReactNode } from 'react';
import { type PressableProps, StyleSheet, useWindowDimensions, View as RNView } from 'react-native';

import { ScalePressable } from '@/components/Animated';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import { Text, useColors } from '@/components/Themed';
import { fontFamily, layout } from '@/constants/Colors';

export const RECIPE_GRID_GAP = layout.gridGap;

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
  fullWidth?: boolean;
  accessibilityActions?: PressableProps['accessibilityActions'];
  onAccessibilityAction?: PressableProps['onAccessibilityAction'];
};

/** A white sheet with a hairline: photo on top, then a two-line title slot and footer aligned across the grid. */
export function RecipeGridCardFrame({
  title,
  thumbnailUrl,
  onPress,
  colors,
  footer,
  imageAdornment,
  imagePriority = 'normal',
  accessibilityLabel,
  selected, fullWidth = false, accessibilityActions, onAccessibilityAction,
}: RecipeGridCardFrameProps) {
  const { width, fontScale } = useWindowDimensions();
  const titleSlotHeight = Math.ceil(40 * fontScale);
  const footerHeight = Math.ceil(18 * fontScale);
  const contentWidth = Math.min(width, 720) - layout.margin * 2;
  const cardWidth = fullWidth || fontScale >= 1.3 ? contentWidth : (contentWidth - RECIPE_GRID_GAP) / 2;

  return (
    <RNView style={[styles.card, { width: cardWidth }]}>
    <ScalePressable
      style={[styles.sheet, { backgroundColor: colors.backgroundElevated, borderColor: colors.hairline }]}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
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
      </RNView>
      <RNView style={[styles.content, { minHeight: 22 + titleSlotHeight + 2 + footerHeight }]}>
        <Text
          style={[styles.title, { color: colors.text, minHeight: titleSlotHeight }]}
          numberOfLines={2}
        >
          {title}
        </Text>
        <RNView style={[styles.footer, { minHeight: footerHeight }]}>{footer}</RNView>
      </RNView>
    </ScalePressable>
    {/* Keep independent photo actions outside the card’s VoiceOver group. */}
    {imageAdornment}
    </RNView>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: RECIPE_GRID_GAP,
  },
  sheet: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  content: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 2,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 15,
    fontFamily: fontFamily.semibold,
    lineHeight: 20,
  },
  footer: {
    justifyContent: 'flex-end',
  },
});
