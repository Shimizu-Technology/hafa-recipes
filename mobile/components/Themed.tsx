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
import Ionicons from '@expo/vector-icons/Ionicons';

import Colors, { spacing, radius, fontSize, fontWeight, fontFamily, shadows } from '@/constants/Colors';
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

// Basic Text component with Inter font
export function Text(props: TextProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');

  return <DefaultText style={[{ color, fontFamily: fontFamily.regular }, style]} {...otherProps} />;
}

// Basic View component
export function View(props: ViewProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');

  return <DefaultView style={[{ backgroundColor }, style]} {...otherProps} />;
}

// Card component with subtle shadow
interface CardProps extends ViewProps {
  children: React.ReactNode;
  noPadding?: boolean;
  elevated?: boolean; // Use stronger shadow
}

export function Card({ children, style, noPadding, elevated, ...props }: CardProps) {
  const colors = useColors();
  const shadowStyle = elevated ? shadows.medium : shadows.card;
  
  return (
    <DefaultView
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.cardBorder,
          padding: noPadding ? 0 : spacing.md,
          // Subtle shadow for depth
          shadowColor: colors.shadowColor,
          ...shadowStyle,
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
  keyboardType?: 'default' | 'url' | 'email-address' | 'numeric' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  secureTextEntry?: boolean;
  maxLength?: number;
  style?: object;
  showClearButton?: boolean;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  returnKeyType?: 'done' | 'go' | 'next' | 'search' | 'send';
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
  secureTextEntry = false,
  maxLength,
  style,
  showClearButton = true,
  autoFocus,
  onSubmitEditing,
  returnKeyType,
}: InputProps) {
  const colors = useColors();
  const showClear = showClearButton && value.length > 0 && editable && !multiline;

  return (
    <DefaultView style={{ position: 'relative' }}>
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
        secureTextEntry={secureTextEntry}
        maxLength={maxLength}
        autoFocus={autoFocus}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        style={[
          {
            backgroundColor: colors.backgroundSecondary,
            borderRadius: radius.md,
            padding: spacing.md,
            paddingRight: showClear ? 40 : spacing.md,
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
      {showClear && (
        <TouchableOpacity
          onPress={() => onChangeText('')}
          style={{
            position: 'absolute',
            right: spacing.sm,
            top: 0,
            bottom: 0,
            justifyContent: 'center',
            paddingHorizontal: spacing.xs,
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <DefaultView
            style={{
              backgroundColor: colors.textMuted,
              borderRadius: 10,
              width: 20,
              height: 20,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Ionicons name="close" size={14} color={colors.background} />
          </DefaultView>
        </TouchableOpacity>
      )}
    </DefaultView>
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
          fontFamily: fontFamily.semibold,
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
