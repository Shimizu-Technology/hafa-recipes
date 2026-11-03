import Ionicons from '@expo/vector-icons/Ionicons';
import { useContext } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  View as RNView,
  useWindowDimensions,
} from 'react-native';

import { Text, TextScaleContext, useColors } from '@/components/Themed';
import { fontFamily, fontSize, fontWeight, radius, spacing } from '@/constants/Colors';

export type RecipeVisibility = 'private' | 'public';

interface RecipeVisibilitySelectorProps {
  value: RecipeVisibility;
  onChange: (value: RecipeVisibility) => void | Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}

const options: Array<{
  value: RecipeVisibility;
  title: string;
  description: string;
  icon: 'lock-closed-outline' | 'globe-outline';
}> = [
  {
    value: 'private',
    title: 'Private',
    description: 'Only you can open this recipe.',
    icon: 'lock-closed-outline',
  },
  {
    value: 'public',
    title: 'Public in Discover',
    description: 'Anyone can find and open this recipe.',
    icon: 'globe-outline',
  },
];

/** An explicit final visibility choice for newly created recipes. */
export function RecipeVisibilitySelector({
  value,
  onChange,
  disabled = false,
  compact = false,
}: RecipeVisibilitySelectorProps) {
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  const textScale = useContext(TextScaleContext);
  // At large text the two choices stack so neither title breaks mid-word.
  const sideBySide = compact && fontScale * textScale < 1.3;

  return (
    <RNView style={styles.container}>
      {!compact && <RNView style={styles.headingRow}>
        <RNView style={[styles.headingIcon, { backgroundColor: colors.accentSoft }]}>
          <Ionicons name="eye-outline" size={18} color={colors.accent} />
        </RNView>
        <RNView style={styles.headingCopy}>
          <Text style={[styles.heading, { color: colors.text }]}>Who can see this recipe?</Text>
          <Text style={[styles.subheading, { color: colors.textMuted }]}>Choose before you save. You can change this later.</Text>
        </RNView>
      </RNView>}

      {/* Compact: a segmented pair on a tonal track, the chosen side a white sheet. Full: two hairline rows, the chosen one in ink. */}
      <RNView style={[styles.options, compact && [styles.track, { backgroundColor: colors.surface2 }], sideBySide && { flexDirection: 'row' }]} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = value === option.value;
          const selectedColor = colors.text;

          return (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.option,
                sideBySide && { flex: 1 },
                compact ? [styles.segment, {
                  backgroundColor: selected ? colors.backgroundElevated : 'rgba(0,0,0,0)',
                  borderColor: selected ? colors.border : 'rgba(0,0,0,0)',
                }] : {
                  backgroundColor: colors.backgroundElevated,
                  borderColor: selected ? selectedColor : colors.border,
                  borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
                },
              ]}
              onPress={() => onChange(option.value)}
              disabled={disabled}
              activeOpacity={0.75}
              accessibilityRole="radio"
              accessibilityLabel={option.title}
              accessibilityHint={option.description}
              accessibilityState={{ checked: selected, disabled }}
            >
              {compact && <Ionicons name={option.icon} size={16} color={selected ? colors.text : colors.textSecondary} />}
              {!compact && <RNView
                style={[
                  styles.optionIcon,
                  { backgroundColor: colors.surface2 },
                ]}
              >
                <Ionicons
                  name={option.icon}
                  size={20}
                  color={selected ? selectedColor : colors.textMuted}
                />
              </RNView>}
              <RNView style={compact ? styles.segmentCopy : styles.optionCopy}>
                <Text
                  style={[
                    styles.optionTitle,
                    { color: compact && !selected ? colors.textSecondary : colors.text },
                  ]}
                >
                  {option.title}
                </Text>
                {!compact && <Text style={[styles.optionDescription, { color: colors.textMuted }]}>
                  {option.description}
                </Text>}
              </RNView>
              {!compact && <Ionicons
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={24}
                color={selected ? selectedColor : colors.textMuted}
              />}
            </TouchableOpacity>
          );
        })}
      </RNView>
      {compact && <Text style={[styles.optionDescription, { color: colors.textMuted, marginTop: spacing.xs }]}>
        {value === 'public' ? 'Anyone can find and open this recipe.' : 'Only you can open this recipe.'}
      </Text>}
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headingIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingCopy: {
    flex: 1,
  },
  heading: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.semibold,
  },
  subheading: {
    fontSize: fontSize.xs,
    lineHeight: 17,
    marginTop: 2,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  track: { borderRadius: 10, padding: 2, gap: 2 },
  segment: { minHeight: 44, borderRadius: 8, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, gap: 6, justifyContent: 'center' },
  segmentCopy: { flexShrink: 1 },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionCopy: {
    flex: 1,
  },
  optionTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  optionDescription: {
    fontSize: fontSize.xs,
    lineHeight: 17,
    marginTop: 2,
  },
});
