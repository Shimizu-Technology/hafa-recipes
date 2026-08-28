import Ionicons from '@expo/vector-icons/Ionicons';
import {
  StyleSheet,
  TouchableOpacity,
  View as RNView,
} from 'react-native';

import { Text, useColors } from '@/components/Themed';
import { fontFamily, fontSize, fontWeight, radius, spacing } from '@/constants/Colors';

export type RecipeVisibility = 'private' | 'public';

interface RecipeVisibilitySelectorProps {
  value: RecipeVisibility;
  onChange: (value: RecipeVisibility) => void | Promise<void>;
  disabled?: boolean;
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
}: RecipeVisibilitySelectorProps) {
  const colors = useColors();

  return (
    <RNView style={styles.container}>
      <RNView style={styles.headingRow}>
        <RNView style={[styles.headingIcon, { backgroundColor: colors.accentSoft }]}>
          <Ionicons name="eye-outline" size={18} color={colors.accent} />
        </RNView>
        <RNView style={styles.headingCopy}>
          <Text style={[styles.heading, { color: colors.text }]}>Who can see this recipe?</Text>
          <Text style={[styles.subheading, { color: colors.textMuted }]}>Choose before you save. You can change this later.</Text>
        </RNView>
      </RNView>

      <RNView style={styles.options} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = value === option.value;
          const selectedColor = option.value === 'public' ? colors.tint : colors.textSecondary;

          return (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.option,
                {
                  backgroundColor: selected
                    ? selectedColor + '12'
                    : colors.backgroundElevated,
                  borderColor: selected ? selectedColor : colors.border,
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
              <RNView
                style={[
                  styles.optionIcon,
                  { backgroundColor: selected ? selectedColor + '18' : colors.backgroundSecondary },
                ]}
              >
                <Ionicons
                  name={option.icon}
                  size={20}
                  color={selected ? selectedColor : colors.textMuted}
                />
              </RNView>
              <RNView style={styles.optionCopy}>
                <Text
                  style={[
                    styles.optionTitle,
                    { color: selected ? selectedColor : colors.text },
                  ]}
                >
                  {option.title}
                </Text>
                <Text style={[styles.optionDescription, { color: colors.textMuted }]}>
                  {option.description}
                </Text>
              </RNView>
              <Ionicons
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={24}
                color={selected ? selectedColor : colors.textMuted}
              />
            </TouchableOpacity>
          );
        })}
      </RNView>
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
    fontFamily: fontFamily.displaySemibold,
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
    borderWidth: 1,
  },
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
