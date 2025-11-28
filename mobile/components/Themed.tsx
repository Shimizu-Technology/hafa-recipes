/**
 * Themed components with clean, minimal styling
 */

import { 
  Text as DefaultText, 
  View as DefaultView, 
  TextInput as DefaultTextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';

import Colors, { spacing, radius, fontSize, fontWeight } from '@/constants/Colors';
import { useColorScheme } from './useColorScheme';

type ThemeProps = {
  lightColor?: string;
  darkColor?: string;
};

export type TextProps = ThemeProps & DefaultText['props'];
export type ViewProps = ThemeProps & DefaultView['props'];

// Hook to get theme colors
export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark
) {
  const theme = useColorScheme() ?? 'light';
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    return Colors[theme][colorName];
  }
}

// Hook to get all theme colors
export function useColors() {
  const theme = useColorScheme() ?? 'light';
  return Colors[theme];
}

// Basic Text component
export function Text(props: TextProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');

  return <DefaultText style={[{ color }, style]} {...otherProps} />;
}

// Basic View component
export function View(props: ViewProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');

  return <DefaultView style={[{ backgroundColor }, style]} {...otherProps} />;
}

// Card component
interface CardProps extends ViewProps {
  children: React.ReactNode;
  noPadding?: boolean;
}

export function Card({ children, style, noPadding, ...props }: CardProps) {
  const colors = useColors();
  
  return (
    <DefaultView
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.cardBorder,
          padding: noPadding ? 0 : spacing.md,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </DefaultView>
  );
}

// Input component
interface InputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  numberOfLines?: number;
  editable?: boolean;
  keyboardType?: 'default' | 'url' | 'email-address' | 'numeric';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  style?: object;
}

export function Input({
  value,
  onChangeText,
  placeholder,
  multiline,
  numberOfLines,
  editable = true,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  autoCorrect = true,
  style,
}: InputProps) {
  const colors = useColors();

  return (
    <DefaultTextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      multiline={multiline}
      numberOfLines={numberOfLines}
      editable={editable}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
      style={[
        {
          backgroundColor: colors.backgroundSecondary,
          borderRadius: radius.md,
          padding: spacing.md,
          fontSize: fontSize.md,
          color: colors.text,
          borderWidth: 1,
          borderColor: colors.border,
          minHeight: multiline ? 100 : undefined,
          textAlignVertical: multiline ? 'top' : 'center',
        },
        style,
      ]}
    />
  );
}

// Button component
interface ButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export function Button({
  title,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  size = 'md',
}: ButtonProps) {
  const colors = useColors();

  const getBackgroundColor = () => {
    if (disabled) return colors.border;
    switch (variant) {
      case 'primary':
        return colors.tint;
      case 'secondary':
        return colors.backgroundSecondary;
      case 'ghost':
        return 'transparent';
      default:
        return colors.tint;
    }
  };

  const getTextColor = () => {
    if (disabled) return colors.textMuted;
    switch (variant) {
      case 'primary':
        return '#FFFFFF';
      case 'secondary':
        return colors.text;
      case 'ghost':
        return colors.tint;
      default:
        return '#FFFFFF';
    }
  };

  const getPadding = () => {
    switch (size) {
      case 'sm':
        return { paddingVertical: spacing.sm, paddingHorizontal: spacing.md };
      case 'lg':
        return { paddingVertical: spacing.lg, paddingHorizontal: spacing.xl };
      default:
        return { paddingVertical: spacing.md, paddingHorizontal: spacing.lg };
    }
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      style={[
        {
          backgroundColor: getBackgroundColor(),
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
        },
        getPadding(),
        variant === 'secondary' && { borderWidth: 1, borderColor: colors.border },
      ]}
    >
      {loading && <ActivityIndicator color={getTextColor()} size="small" />}
      <DefaultText
        style={{
          color: getTextColor(),
          fontSize: size === 'lg' ? fontSize.lg : fontSize.md,
          fontWeight: fontWeight.semibold,
        }}
      >
        {title}
      </DefaultText>
    </TouchableOpacity>
  );
}

// Chip/Badge component
interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  size?: 'sm' | 'md';
}

export function Chip({ label, selected, onPress, size = 'md' }: ChipProps) {
  const colors = useColors();

  const content = (
    <DefaultView
      style={[
        {
          backgroundColor: selected ? colors.tint : colors.backgroundSecondary,
          borderRadius: radius.full,
          paddingVertical: size === 'sm' ? spacing.xs : spacing.sm,
          paddingHorizontal: size === 'sm' ? spacing.sm : spacing.md,
          borderWidth: 1,
          borderColor: selected ? colors.tint : colors.border,
        },
      ]}
    >
      <DefaultText
        style={{
          color: selected ? '#FFFFFF' : colors.text,
          fontSize: size === 'sm' ? fontSize.xs : fontSize.sm,
          fontWeight: selected ? fontWeight.semibold : fontWeight.normal,
        }}
      >
        {label}
      </DefaultText>
    </DefaultView>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

// Section Header
interface SectionHeaderProps {
  title: string;
  subtitle?: string;
}

export function SectionHeader({ title, subtitle }: SectionHeaderProps) {
  const colors = useColors();

  return (
    <DefaultView style={{ marginBottom: spacing.md }}>
      <DefaultText
        style={{
          fontSize: fontSize.xs,
          fontWeight: fontWeight.semibold,
          color: colors.textMuted,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: subtitle ? spacing.xs : 0,
        }}
      >
        {title}
      </DefaultText>
      {subtitle && (
        <DefaultText
          style={{
            fontSize: fontSize.sm,
            color: colors.textSecondary,
          }}
        >
          {subtitle}
        </DefaultText>
      )}
    </DefaultView>
  );
}

// Divider
export function Divider() {
  const colors = useColors();

  return (
    <DefaultView
      style={{
        height: 1,
        backgroundColor: colors.border,
        marginVertical: spacing.md,
      }}
    />
  );
}
