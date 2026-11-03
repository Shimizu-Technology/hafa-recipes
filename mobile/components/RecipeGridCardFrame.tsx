import type { ReactNode } from 'react';
import { type PressableProps, StyleSheet, useWindowDimensions, View as RNView } from 'react-native';

import { ScalePressable } from '@/components/Animated';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import { Text, useColors } from '@/components/Themed';
import { fontFamily } from '@/constants/Colors';
import { useLook } from '@/contexts/LookContext';

export const RECIPE_GRID_GAP = 12;

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
  selected, fullWidth = false, accessibilityActions, onAccessibilityAction,
}: RecipeGridCardFrameProps) {
  const { width, fontScale } = useWindowDimensions();
  const look = useLook();
  const preview = look.id !== 'current';
  const variant = look.variants.card;
  const enclosed = variant === 'raised' || variant === 'sheet';
  const titleLine = preview && variant === 'flat' ? 22 : preview ? 20 : 21;
  const titleSlotHeight = Math.ceil(titleLine * 2 * fontScale);
  const footerHeight = Math.ceil(18 * fontScale);
  const contentWidth = Math.min(width, 720);
  const margin = look.density.margin * 2;
  const gap = preview ? look.density.gridGap : RECIPE_GRID_GAP;
  const cardWidth = fullWidth || fontScale >= 1.3 ? contentWidth - margin : (contentWidth - margin - gap) / 2;
  // Cookbook: flat portrait photos at radius 8 with a Fraunces title below. Island: a white card at radius 24
  // with a soft shadow. Calm: a white sheet with a hairline. Current is unchanged.
  const titleStyle = preview ? {
    fontFamily: look.fonts?.cardTitle, fontWeight: 'normal' as const,
    fontSize: variant === 'flat' ? 17 : 15, lineHeight: titleLine,
  } : null;
  const shell = enclosed ? [{ backgroundColor: colors.backgroundElevated, borderRadius: look.radii.card },
    variant === 'raised' ? look.shadows.card : { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }] : null;

  return (
    <RNView style={[styles.card, { width: cardWidth }, preview && { marginBottom: variant === 'flat' ? 24 : gap + 4 }]}>
    <ScalePressable
      style={shell}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={selected === undefined ? undefined : { selected }}
    >
      <RNView style={[styles.imageContainer, preview && {
        borderRadius: enclosed ? 0 : look.radii.photo,
        borderTopLeftRadius: look.radii.card, borderTopRightRadius: look.radii.card,
        ...(enclosed ? null : { borderBottomLeftRadius: look.radii.photo, borderBottomRightRadius: look.radii.photo }),
        aspectRatio: variant === 'flat' && !fullWidth && fontScale < 1.3 ? 4 / 5 : 1,
      }]}>
        <RecipeThumbnail
          uri={thumbnailUrl}
          style={styles.image}
          accessibilityLabel={`${title} photo`}
          placeholderIconSize={40}
          priority={imagePriority}
          placeholderTitle={title}
        />
      </RNView>
      <RNView style={[styles.content, { minHeight: 8 + titleSlotHeight + 2 + footerHeight },
        preview && (enclosed ? { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, minHeight: 22 + titleSlotHeight + 2 + footerHeight } : { paddingTop: 10 })]}>
        <Text
          style={[styles.title, { color: colors.text, minHeight: titleSlotHeight }, titleStyle]}
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
    marginBottom: 20,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 1,
    position: 'relative',
    borderRadius: 14,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  content: {
    paddingTop: 8,
    gap: 2,
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
