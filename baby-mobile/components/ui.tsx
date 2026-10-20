import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren, type RefObject } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextInputProps,
  type ViewStyle,
  type ColorValue,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { inputTraits, type InputPurpose } from "@/lib/input-purpose";
const light = {
  background: "#F8F6F0",
  surface: "#FFFFFF",
  soft: "#EDF1E9",
  hero: "#DDE7D8",
  text: "#233A2E",
  muted: "#607065",
  action: "#355C49",
  onAction: "#FFFFFF",
  border: "#DEE3DA",
  error: "#9A3431",
  errorBg: "#FAEBE6",
  warm: "#EEE5D6",
};
const dark = {
  background: "#151D19",
  surface: "#202B24",
  soft: "#28362C",
  hero: "#304936",
  text: "#EDF3E9",
  muted: "#B0C0B1",
  action: "#C1D9B8",
  onAction: "#183020",
  border: "#405044",
  error: "#FFB4A9",
  errorBg: "#402924",
  warm: "#3D352B",
};
export function useColors() {
  return useColorScheme() === "dark" ? dark : light;
}
export type IconName = React.ComponentProps<typeof Ionicons>["name"];
export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: ColorValue }) {
  const c = useColors();
  return <Ionicons name={name} size={size} color={color ?? c.action} accessible={false} />;
}
export function Copy({
  children,
  kind = "body",
  tone,
  align,
}: {
  children: React.ReactNode;
  kind?: "body" | "small" | "heading" | "title" | "eyebrow";
  tone?: "muted" | "error";
  align?: "left" | "center";
}) {
  const c = useColors();
  return (
    <Text
      style={{
        color: tone === "error" ? c.error : tone === "muted" ? c.muted : c.text,
        fontSize:
          kind === "title" ? 32 : kind === "heading" ? 21 : kind === "small" ? 13 : kind === "eyebrow" ? 11 : 16,
        fontWeight: kind === "body" || kind === "small" ? "400" : "600",
        letterSpacing: kind === "eyebrow" ? 2 : kind === "title" ? -0.8 : 0,
        lineHeight:
          kind === "title" ? 39 : kind === "heading" ? 28 : kind === "small" ? 20 : kind === "eyebrow" ? 18 : 25,
        textAlign: align,
      }}
    >
      {children}
    </Text>
  );
}
export function Screen({
  children,
  title,
  subtitle,
  eyebrow,
  back = false,
  action,
  scroll = true,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  back?: boolean;
  action?: React.ReactNode;
  scroll?: boolean;
}) {
  const c = useColors();
  const content = (
    <View
      style={{
        paddingHorizontal: 22,
        paddingTop: 12,
        paddingBottom: 34,
        gap: 20,
        width: "100%",
        maxWidth: 720,
        alignSelf: "center",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        {back && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
            style={({ pressed }) => ({ paddingVertical: 8, minWidth: 44, opacity: pressed ? 0.55 : 1 })}
          >
            <Icon name="arrow-back" />
          </Pressable>
        )}
        <View style={{ flex: 1, gap: 5 }}>
          <Copy kind="eyebrow" tone="muted">
            {eyebrow ?? "HÅFA BABY"}
          </Copy>
          <Copy kind="title">{title}</Copy>
          {subtitle && <Copy tone="muted">{subtitle}</Copy>}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{ flexGrow: 1 }}
          >
            {content}
          </ScrollView>
        ) : (
          content
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Card({
  children,
  tone = "normal",
  style,
}: {
  children: React.ReactNode;
  tone?: "normal" | "hero" | "soft";
  style?: ViewStyle;
}) {
  const c = useColors();
  return (
    <View
      style={[
        {
          padding: 20,
          gap: 12,
          borderRadius: 24,
          backgroundColor: tone === "hero" ? c.hero : tone === "soft" ? c.soft : c.surface,
          borderWidth: tone === "normal" ? 1 : 0,
          borderColor: c.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function Button({
  title,
  onPress,
  busy = false,
  disabled = false,
  secondary = false,
  variant,
  icon,
  size,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
  variant?: "ghost";
  icon?: IconName;
  size?: "lg";
}) {
  const c = useColors(),
    quiet = secondary || variant === "ghost";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: size === "lg" ? 56 : 50,
        paddingHorizontal: 20,
        paddingVertical: 13,
        borderRadius: 26,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        backgroundColor: variant === "ghost" ? "transparent" : quiet ? c.soft : c.action,
        opacity: disabled || busy ? 0.5 : pressed ? 0.75 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={quiet ? c.action : c.onAction} />
      ) : (
        icon && <Icon name={icon} size={19} color={quiet ? c.action : c.onAction} />
      )}
      <Text
        style={{
          fontSize: 16,
          fontWeight: "600",
          color: quiet ? c.action : c.onAction,
          textAlign: "center",
          flexShrink: 1,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  secret,
  purpose,
  numeric,
  disabled,
  inputRef,
  onSubmit,
  returnKeyType,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  secret?: boolean;
  purpose?: InputPurpose;
  numeric?: boolean;
  disabled?: boolean;
  inputRef?: RefObject<TextInput | null>;
  onSubmit?: () => void;
  returnKeyType?: TextInputProps["returnKeyType"];
  maxLength?: number;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 7 }}>
      <Copy kind="small">{label}</Copy>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        secureTextEntry={!!secret}
        editable={!disabled}
        multiline={multiline}
        autoCapitalize={purpose || secret ? "none" : "sentences"}
        {...inputTraits(purpose, Platform.OS, numeric)}
        maxLength={maxLength ?? inputTraits(purpose, Platform.OS, numeric).maxLength ?? (multiline ? 30000 : 1000)}
        onSubmitEditing={onSubmit}
        returnKeyType={returnKeyType}
        textAlignVertical={multiline ? "top" : "center"}
        style={{
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
          color: c.text,
          borderRadius: 16,
          padding: 15,
          fontSize: 16,
          lineHeight: 24,
          minHeight: multiline ? 150 : 52,
        }}
      />
    </View>
  );
}
export function Notice({ children, error }: { children: React.ReactNode; error?: boolean }) {
  const c = useColors();
  return (
    <View
      accessibilityRole={error ? "alert" : undefined}
      style={{ padding: 15, borderRadius: 16, backgroundColor: error ? c.errorBg : c.soft }}
    >
      <Copy tone={error ? "error" : "muted"}>{children}</Copy>
    </View>
  );
}
export function Choice({
  label,
  detail,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        paddingVertical: 13,
        minHeight: 50,
        flexDirection: "row",
        gap: 12,
        alignItems: "center",
        opacity: pressed ? 0.6 : disabled ? 0.5 : 1,
      })}
    >
      <Icon name={selected ? "checkbox" : "square-outline"} color={selected ? c.action : c.muted} />
      <View style={{ flex: 1, gap: 3 }}>
        <Copy>{label}</Copy>
        {detail && (
          <Copy kind="small" tone="muted">
            {detail}
          </Copy>
        )}
      </View>
    </Pressable>
  );
}
export function Chips({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="button"
          accessibilityState={{ selected: value === o.value }}
          onPress={() => onChange(o.value)}
          style={({ pressed }) => ({
            minHeight: 44,
            paddingHorizontal: 16,
            paddingVertical: 11,
            borderRadius: 23,
            backgroundColor: value === o.value ? c.action : c.soft,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ fontSize: 14, fontWeight: "600", color: value === o.value ? c.onAction : c.text }}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function Empty({
  icon = "leaf-outline",
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <Card tone="soft">
      <View style={{ alignSelf: "flex-start", padding: 8 }}>
        <Icon name={icon} size={34} />
      </View>
      <Copy kind="heading">{title}</Copy>
      <Copy tone="muted">{body}</Copy>
      {action}
    </Card>
  );
}
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Copy kind="heading">{title}</Copy>
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}
export function Row({
  title,
  detail,
  icon,
  onPress,
  trailing,
}: {
  title: string;
  detail?: string;
  icon?: IconName;
  onPress: () => void;
  trailing?: React.ReactNode;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 70,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
        padding: 16,
        borderRadius: 19,
        flexDirection: "row",
        alignItems: "center",
        gap: 13,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {icon && <Icon name={icon} />}
      <View style={{ flex: 1, gap: 3 }}>
        <Copy>{title}</Copy>
        {detail && (
          <Copy kind="small" tone="muted">
            {detail}
          </Copy>
        )}
      </View>
      {trailing ?? <Icon name="chevron-forward" size={17} color={c.muted} />}
    </Pressable>
  );
}
const ToastContext = createContext<(value: string) => void>(() => undefined);
export function useToast() {
  return useContext(ToastContext);
}
export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState(""),
    c = useColors();
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  return (
    <ToastContext.Provider value={setToast}>
      {children}
      {!!toast && (
        <Pressable
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          onPress={() => setToast("")}
          style={{
            position: "absolute",
            bottom: 105,
            left: 22,
            right: 22,
            backgroundColor: c.text,
            padding: 17,
            borderRadius: 18,
          }}
        >
          <Text style={{ color: c.background, fontSize: 15 }}>{toast}</Text>
        </Pressable>
      )}
    </ToastContext.Provider>
  );
}
export function Loading({ label = "Opening your private space…" }: { label?: string }) {
  return (
    <View style={{ padding: 30, gap: 20 }}>
      <ActivityIndicator accessibilityLabel={label} />
      <Copy align="center" tone="muted">
        {label}
      </Copy>
    </View>
  );
}
