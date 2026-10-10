import { inputTraits, type InputPurpose } from "@/lib/input-purpose";
import type { PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";

const light = {
  background: "#F6F3EC",
  surface: "#FFFEFA",
  text: "#172820",
  muted: "#57645B",
  border: "#D9DED4",
  action: "#225B45",
  onAction: "#FFFFFF",
  tint: "#E7EEE0",
  accent: "#C1DA80",
  error: "#9E302B",
};
const dark = {
  background: "#121D17",
  surface: "#1D2B23",
  text: "#F3F3E7",
  muted: "#BCC8BB",
  border: "#435447",
  action: "#C1DA80",
  onAction: "#16281D",
  tint: "#2C3D2F",
  accent: "#C1DA80",
  error: "#FFAAA3",
};
export function useColors() {
  return useColorScheme() === "dark" ? dark : light;
}
export function Copy({
  children,
  kind = "body",
  color,
  style,
}: PropsWithChildren<{
  kind?: "title" | "heading" | "body" | "label" | "small";
  color?: string;
  style?: import("react-native").StyleProp<import("react-native").TextStyle>;
}>) {
  const c = useColors();
  return <Text style={[type[kind], { color: color ?? c.text }, style]}>{children}</Text>;
}
export function Screen({
  children,
  title,
  subtitle,
  back = false,
  action,
}: PropsWithChildren<{ title: string; subtitle?: string; back?: boolean; action?: ReactNode }>) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 24,
          gap: 24,
          width: "100%",
          maxWidth: 660,
          alignSelf: "center",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          {back ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={() => router.back()}
              style={{ minWidth: 48, minHeight: 48, justifyContent: "center" }}
            >
              <Ionicons name="arrow-back" size={25} color={c.text} />
            </Pressable>
          ) : (
            <View style={{ flex: 1 }}>
              <Copy kind="label" color={c.muted}>
                HÅFA WORKOUTS
              </Copy>
            </View>
          )}
          {action}
        </View>
        <View style={{ gap: 8 }}>
          <Copy kind="title">{title}</Copy>
          {!!subtitle && <Copy color={c.muted}>{subtitle}</Copy>}
        </View>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
  busy = false,
  icon,
}: {
  title: string;
  onPress(): void;
  secondary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      aria-disabled={disabled || busy}
      aria-busy={busy}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 54,
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderRadius: 18,
        backgroundColor: secondary ? c.tint : c.action,
        opacity: disabled || busy ? 0.6 : pressed ? 0.8 : 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
      })}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? c.text : c.onAction} />
      ) : icon ? (
        <Ionicons name={icon} color={secondary ? c.text : c.onAction} size={21} />
      ) : null}
      <Copy kind="label" color={secondary ? c.text : c.onAction} style={{ textAlign: "center", flexShrink: 1 }}>
        {title}
      </Copy>
    </Pressable>
  );
}
export function Card({ children, tone = "plain" }: PropsWithChildren<{ tone?: "plain" | "hero" }>) {
  const c = useColors();
  return (
    <View
      style={{
        padding: 24,
        gap: 16,
        borderRadius: 26,
        backgroundColor: tone === "hero" ? "#225B45" : c.surface,
        borderWidth: tone === "hero" ? 0 : 1,
        borderColor: c.border,
      }}
    >
      {children}
    </View>
  );
}
export function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  numeric = false,
  secret = false,
  optional = false,
  disabled = false,
  purpose,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  multiline?: boolean;
  numeric?: boolean;
  secret?: boolean;
  optional?: boolean;
  disabled?: boolean;
  purpose?: InputPurpose;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 8 }}>
      <Copy kind="label">
        {label}
        {optional ? " · optional" : ""}
      </Copy>
      <TextInput
        key={purpose ?? "general"}
        {...inputTraits(purpose, Platform.OS, numeric)}
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        aria-disabled={disabled}
        editable={!disabled}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        multiline={multiline}
        secureTextEntry={secret}
        autoCapitalize="none"
        style={{
          fontFamily: "DMSans_400Regular",
          fontSize: 17,
          lineHeight: 25,
          color: c.text,
          borderColor: c.border,
          borderWidth: 1,
          backgroundColor: c.surface,
          borderRadius: 16,
          padding: 16,
          minHeight: multiline ? 110 : 56,
          textAlignVertical: multiline ? "top" : "center",
        }}
      />
    </View>
  );
}
export function Choice({
  label,
  detail,
  selected,
  onPress,
  disabled = false,
  busy = false,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress(): void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled: disabled || busy, busy }}
      aria-checked={selected}
      aria-disabled={disabled || busy}
      aria-busy={busy}
      disabled={disabled || busy}
      style={({ pressed }) => ({
        minHeight: 56,
        padding: 16,
        borderRadius: 17,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? c.action : c.border,
        backgroundColor: selected ? c.tint : c.surface,
        opacity: disabled || busy ? 0.6 : pressed ? 0.8 : 1,
        flexDirection: "row",
        gap: 12,
        alignItems: "center",
      })}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Copy kind="label">{label}</Copy>
        {!!detail && (
          <Copy kind="small" color={c.muted}>
            {detail}
          </Copy>
        )}
      </View>
      <Ionicons
        name={selected ? "checkmark-circle" : "ellipse-outline"}
        size={24}
        color={selected ? c.action : c.muted}
      />
    </Pressable>
  );
}
export function Notice({ children, error = false }: PropsWithChildren<{ error?: boolean }>) {
  const c = useColors();
  return (
    <View accessibilityLiveRegion="polite" style={{ padding: 16, gap: 4, borderRadius: 16, backgroundColor: c.tint }}>
      <Copy kind="small" color={error ? c.error : c.muted}>
        {children}
      </Copy>
    </View>
  );
}
export function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const c = useColors();
  return (
    <Card>
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 17,
          backgroundColor: c.tint,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} color={c.action} size={27} />
      </View>
      <Copy kind="heading">{title}</Copy>
      <Copy color={c.muted}>{description}</Copy>
      {action}
    </Card>
  );
}
export function AccountButton() {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open account and settings"
      onPress={() => router.push("/settings")}
      style={{
        width: 48,
        height: 48,
        backgroundColor: c.tint,
        borderRadius: 24,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons name="person-outline" size={23} color={c.text} />
    </Pressable>
  );
}
const type = StyleSheet.create({
  title: { fontFamily: "DMSans_700Bold", fontSize: 36, lineHeight: 42, letterSpacing: -1 },
  heading: { fontFamily: "DMSans_700Bold", fontSize: 23, lineHeight: 29, letterSpacing: -0.4 },
  body: { fontFamily: "DMSans_400Regular", fontSize: 17, lineHeight: 26 },
  label: { fontFamily: "DMSans_600SemiBold", fontSize: 16, lineHeight: 23 },
  small: { fontFamily: "DMSans_400Regular", fontSize: 14, lineHeight: 21 },
});
