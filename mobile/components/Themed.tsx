import { createContext, useContext } from 'react';
/**
 * Themed components with clean, minimal styling
 */

import { 
  Text as DefaultText, 
  View as DefaultView, 
  TextInput as DefaultTextInput,
  type AccessibilityRole,
  StyleSheet,
  ActivityIndicator,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import Colors, { spacing, radius, fontSize, fontFamily, shadows, typography, lineHeightForSize } from '@/constants/Colors';
import { useColorScheme } from './useColorScheme';
import { ScalePressable } from './Animated';



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

const TextMetricsContext = createContext<{ fontSize: number; lineHeight: number } | null>(null);

// Nested text keeps its parent's metrics, including recipe text-size overrides.
export function Text(props: TextProps) {
  const {
    style,
    lightColor,
    darkColor,
    ...otherProps
  } = props;
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');

  const inherited = useContext(TextMetricsContext);
  const resolved = StyleSheet.flatten(style);
  const size = resolved?.fontSize ?? inherited?.fontSize ?? typography.body.fontSize;
  const leading = resolved?.lineHeight ?? (resolved?.fontSize !== undefined
    ? lineHeightForSize(size)
    : inherited?.lineHeight ?? lineHeightForSize(size));
  const defaults = inherited
    ? { fontSize: size, lineHeight: leading, ...((lightColor || darkColor) ? { color } : {}) }
    : { color, fontFamily: fontFamily.regular, ...typography.body, fontSize: size, lineHeight: leading };
  return (
    <TextMetricsContext.Provider value={{ fontSize: size, lineHeight: leading }}>
      <DefaultText style={[defaults, style]} {...otherProps} />
    </TextMetricsContext.Provider>
  );
}

// Basic View component
export function View(props: ViewProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');

  return <DefaultView style={[{ backgroundColor }, style]} {...otherProps} />;
}

// Card component with warm, tactile surface styling
interface CardProps extends ViewProps {
  children: React.ReactNode;
  noPadding?: boolean;
  elevated?: boolean; // Use stronger shadow
}

export function Card({ children, style, noPadding, elevated, ...props }: CardProps) {
  const colors = useColors();
  const shadowStyle = elevated ? shadows.medium : {};
  
  return (
    <DefaultView
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: radius.md,
          padding: noPadding ? 0 : spacing.lg,
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
  accessibilityLabel?: string;
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
  style?: StyleProp<TextStyle>;
  showClearButton?: boolean;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  returnKeyType?: 'done' | 'go' | 'next' | 'search' | 'send';
  textContentType?: 'emailAddress' | 'password' | 'newPassword' | 'oneTimeCode' | 'none';
  /** Focus target for keyboard "next" chaining between fields. */
  inputRef?: React.Ref<DefaultTextInput>;
}

export function Input({
  accessibilityLabel,
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
  onFocus,
  onBlur,
  returnKeyType,
  textContentType,
  inputRef,
}: InputProps) {
  const colors = useColors();
  const showClear = showClearButton && value.length > 0 && editable && !multiline;

  return (
    <DefaultView style={{ position: 'relative' }}>
      <DefaultTextInput
        ref={inputRef}
        textContentType={textContentType}
        accessibilityLabel={accessibilityLabel}
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
        onFocus={onFocus}
        onBlur={onBlur}
        returnKeyType={returnKeyType}
        style={[
          {
            backgroundColor: colors.surface2,
            borderRadius: radius.sm,
            padding: spacing.md,
            paddingRight: showClear ? 56 : spacing.md,
            ...typography.body,
            color: colors.text,
            fontFamily: fontFamily.medium,
            minHeight: multiline ? 100 : 44,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          style,
        ]}
      />
      {showClear && (
        <IconButton
          icon="close-circle"
          accessibilityLabel={`Clear ${accessibilityLabel || placeholder || 'text'}`}
          onPress={() => onChangeText('')}
          disabled={!editable}
          style={{ position: 'absolute', right: spacing.xs, top: 0, bottom: 0 }}
        />
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
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  size = 'md',
  style,
}: ButtonProps) {
  const colors = useColors();

  const getBackgroundColor = () => {
    if (disabled) return colors.border;
    switch (variant) {
      case 'primary':
        return colors.tint;
      case 'secondary':
      case 'outline':
        return colors.surface2;
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
        return colors.onTint;
      case 'secondary':
      case 'outline':
        return colors.text;
      case 'ghost':
        return colors.actionText;
      default:
        return colors.onTint;
    }
  };

  const getPadding = () => {
    switch (size) {
      case 'sm':
        return { paddingVertical: spacing.sm, paddingHorizontal: spacing.md };
      case 'lg':
        return { paddingVertical: 14, paddingHorizontal: spacing.xl };
      default:
        return { paddingVertical: 14, paddingHorizontal: spacing.lg };
    }
  };

  return (
    <ScalePressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      style={[
        {
          minHeight: size === 'sm' ? 44 : 50,
          minWidth: 44,
          backgroundColor: getBackgroundColor(),
          borderRadius: radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
        },
        getPadding(),
        style,
      ]}
    >
      {loading && <ActivityIndicator color={getTextColor()} size="small" />}
      <DefaultText
        style={{
          color: getTextColor(),
          flexShrink: 1,
          textAlign: 'center',
          ...typography.headline,
          fontFamily: fontFamily.semibold,
        }}
      >
        {title}
      </DefaultText>
    </ScalePressable>
  );
}

// Chip/Badge component
interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  size?: 'sm' | 'md';
  accessibilityLabel?: string;
  accessibilityRole?: Extract<AccessibilityRole, 'button' | 'radio' | 'checkbox'>;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}

export function Chip({ label, selected, onPress, size = 'md', accessibilityLabel, accessibilityRole = selected === undefined ? 'button' : 'checkbox', icon }: ChipProps) {
  const colors = useColors();

  const content = (
    <DefaultView
      style={[
        {
          backgroundColor: selected ? colors.text : colors.surface2,
          minHeight: onPress ? 44 : undefined,
          minWidth: onPress ? 44 : undefined,
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.xs,
          borderRadius: radius.full,
          paddingVertical: size === 'sm' ? spacing.xs : spacing.sm,
          paddingHorizontal: size === 'sm' ? spacing.sm : spacing.md,
        },
      ]}
    >
      {icon && <Ionicons name={icon} size={16} color={selected ? colors.background : colors.textMuted} />}
      <DefaultText
        style={{
          flexShrink: 1,
          color: selected ? colors.background : colors.text,
          fontSize: size === 'sm' ? fontSize.xs : fontSize.sm,
          fontWeight: selected ? '600' : '500',
          lineHeight: size === 'sm' ? 13 : 18,
          textAlign: 'center',
          includeFontPadding: false,
          fontFamily: fontFamily.regular,
        }}
      >
        {label}
      </DefaultText>
    </DefaultView>
  );

  if (onPress) {
    return (
      <ScalePressable
        onPress={onPress}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel || label}
        accessibilityState={{ ...(selected === undefined ? {} : { selected }), ...(accessibilityRole === 'checkbox' || accessibilityRole === 'radio' ? { checked: Boolean(selected) } : {}) }}
      >
        {content}
      </ScalePressable>
    );
  }

  return content;
}

// Labelled icon control: a 44pt target even when the glyph is smaller.
export function IconButton({ icon, accessibilityLabel, onPress, disabled, style, color, size = 22 }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  color?: string;
  size?: number;
}) {
  const colors = useColors();
  return (
    <ScalePressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }, style]}
    >
      <Ionicons name={icon} size={size} color={color || colors.textMuted} />
    </ScalePressable>
  );
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
          fontSize: 20,
          lineHeight: 25,
          fontFamily: fontFamily.displaySemibold,
          color: colors.textSecondary,
          marginBottom: subtitle ? spacing.xs : 0,
        }}
      >
        {title}
      </DefaultText>
      {subtitle && (
        <DefaultText
            style={{
            ...typography.footnote,
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
