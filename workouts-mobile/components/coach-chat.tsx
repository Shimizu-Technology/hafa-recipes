import { useEffect, useRef, useState, type PropsWithChildren, type ReactNode, type Ref } from "react";
import { AccessibilityInfo, Animated, Dimensions, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View, type ScrollViewProps, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Copy, IconButton, useColors, useReducedMotion } from "./ui";
import { contentWidth, motion, radii, spacing, typography } from "@/constants/theme";

/**
 * Full-height chat layout for Coach, presented as a sheet: close · title · ···
 * on top, messages filling the middle, and a composer pinned above the keyboard.
 */
export function CoachChatShell({ children, title = "Coach", menu, banner, footer, overlay, scrollRef, onScroll, onContentSizeChange }: PropsWithChildren<{
  title?: string;
  menu?: () => void;
  banner?: ReactNode;
  footer?: ReactNode;
  overlay?: ReactNode;
  scrollRef?: Ref<ScrollView>;
  onScroll?: ScrollViewProps["onScroll"];
  onContentSizeChange?: ScrollViewProps["onContentSizeChange"];
}>) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  // iOS presents Coach as a page sheet, which already clears the status bar.
  const sheet = Platform.OS === "ios";
  const root = useRef<View | null>(null);
  const [offset, setOffset] = useState(0);
  // The keyboard frame is in screen coordinates. Inside an iOS page sheet,
  // measureInWindow reports the sheet's own origin (0), which left the composer
  // behind the keyboard; a page sheet is bottom-anchored, so its top gap is the
  // screen height minus the sheet's height.
  const measure = () => root.current?.measureInWindow?.((_x, y, _width, height) => setOffset(
    sheet && height > 0 ? Math.max(0, Dimensions.get("screen").height - height) : Math.max(0, y)));
  // Measure again once the sheet has finished sliding in; the first layout can land mid-animation.
  useEffect(() => { const timer = setTimeout(measure, 600); return () => clearTimeout(timer); }, []);
  const column: ViewStyle = { width: "100%", maxWidth: contentWidth, alignSelf: "center" };
  return (
    // A sheet starts below the window top; the keyboard math needs that offset.
    <View ref={root} style={{ flex: 1, backgroundColor: c.background }}
      onLayout={measure}>
      <KeyboardAvoidingView style={{ flex: 1, paddingTop: sheet ? 0 : insets.top }}
        behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={offset}>
        <View style={[column, { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 56, paddingHorizontal: spacing.xs }]}>
          <IconButton icon="close" label="Close coach" variant="plain"
            onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/library")} />
          <Copy kind="subheading" align="center" style={{ flex: 1 }} numberOfLines={1}>{title}</Copy>
          {menu ? <IconButton icon="ellipsis-horizontal" label="Coach options" variant="plain" onPress={menu} /> : <View style={{ width: 48 }} />}
        </View>
        {banner}
        {/* The snackbar floats over the bottom of the messages, never over the composer. */}
        <View style={{ flex: 1, minHeight: 0 }}>
        <ScrollView
          ref={scrollRef}
          style={Platform.OS === "web" ? { overflowAnchor: "none" } as ViewStyle : undefined}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          scrollEventThrottle={onScroll ? 100 : undefined}
          onScroll={onScroll}
          onContentSizeChange={onContentSizeChange}
          contentContainerStyle={[column, { flexGrow: 1, gap: spacing.md, paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.lg }]}
        >
          {children}
        </ScrollView>
        {overlay}
        </View>
        {!!footer && (
          <View style={{ flexShrink: 1, minHeight: 0, paddingHorizontal: spacing.sm, paddingTop: spacing.xs,
            paddingBottom: Math.max(insets.bottom, spacing.xs) + 4, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface }}>
            <View style={[column, { flexShrink: 1, minHeight: 0, gap: spacing.xs }]}>{footer}</View>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

/** Borderless-feel multiline composer input; the label is for VoiceOver only. */
export function CoachInput({ label, value, onChange, placeholder, disabled = false }: {
  label: string; value: string; onChange(value: string): void; placeholder?: string; disabled?: boolean;
}) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      editable={!disabled}
      multiline
      value={value}
      onChangeText={onChange}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      placeholderTextColor={c.muted}
      style={[typography.body, {
        flex: 1, minHeight: 44, maxHeight: 132, color: c.text, backgroundColor: c.elevated,
        borderWidth: 1, borderColor: focused ? c.focus : c.border, borderRadius: 22,
        paddingHorizontal: spacing.md, paddingTop: 10, paddingBottom: 10, textAlignVertical: "center",
        opacity: disabled ? 0.6 : 1,
      }]}
    />
  );
}

export type Snack = { id: number; text: string; action?: { label: string; onPress(): void } };
/** In-sheet snackbar: the app-wide toast sits under a native sheet, so Coach shows its own. */
export function CoachSnackbar({ snack, onDone }: { snack: Snack | null; onDone(id: number): void }) {
  const c = useColors();
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!snack) return;
    // accessibilityLiveRegion is Android-only; VoiceOver needs an explicit announcement.
    AccessibilityInfo.announceForAccessibility?.(snack.action ? `${snack.text}. ${snack.action.label} available.` : snack.text);
    opacity.setValue(reduced ? 1 : 0);
    if (!reduced) Animated.timing(opacity, { toValue: 1, duration: motion.base, useNativeDriver: Platform.OS !== "web" }).start();
    const timer = setTimeout(() => onDone(snack.id), snack.action ? 6000 : 2400);
    return () => clearTimeout(timer);
  }, [snack?.id]);
  if (!snack) return null;
  return (
    <Animated.View accessibilityLiveRegion="polite" pointerEvents="box-none"
      style={{ position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.xs, alignItems: "center", opacity, zIndex: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, maxWidth: contentWidth, minHeight: 48,
        paddingLeft: spacing.md, paddingRight: snack.action ? spacing.xxs : spacing.md, borderRadius: radii.full, backgroundColor: c.text }}>
        <Copy kind="label" color={c.background} style={{ flexShrink: 1 }}>{snack.text}</Copy>
        {snack.action && <Pressable accessibilityRole="button" accessibilityLabel={snack.action.label} onPress={snack.action.onPress}
          style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.full, backgroundColor: c.background }}>
          <Copy kind="label">{snack.action.label}</Copy>
        </Pressable>}
      </View>
    </Animated.View>
  );
}
