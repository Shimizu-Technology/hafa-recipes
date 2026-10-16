import { Children, createContext, Fragment, isValidElement, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren, type ReactElement, type ReactNode, type Ref } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { contentWidth, elevation, motion, radii, spacing } from "@/constants/theme";
import { BrandLockup, BrandMark } from "../brand-mark";
import { Copy, SurfaceProvider, useColors, useReducedMotion, useSurface } from "./foundation";
import { Chip, IconButton, type IconName } from "./controls";

/**
 * Standard scrolling screen. Root tabs show the Håfa Workouts lockup; pushed
 * screens show a back button. `footer` pins actions above the home indicator
 * so the main action stays in thumb reach.
 */
export function Screen({
  children,
  title,
  subtitle,
  eyebrow,
  back = false,
  action,
  footer,
  refreshing,
  onRefresh,
  onEndReached,
  scrollRef,
  onScroll,
  onContentSizeChange,
  disableBrowserScrollAnchoring = false,
  constrainFooter = false,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  /** Small line above the title (e.g. the date, or a step count). */
  eyebrow?: string;
  back?: boolean;
  action?: ReactNode;
  footer?: ReactNode;
  /** Pull to refresh. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Called when the person scrolls near the end (infinite feeds). */
  onEndReached?: () => void;
  /** Opt out when this screen restores reading position itself. Web only. */
  disableBrowserScrollAnchoring?: boolean;
  /** Let a footer with its own scrolling body shrink above the keyboard. */
  constrainFooter?: boolean;
  scrollRef?: Ref<ScrollView>;
  onScroll?: ScrollViewProps["onScroll"];
  onContentSizeChange?: ScrollViewProps["onContentSizeChange"];
}>) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ paddingHorizontal: spacing.lg - 4, paddingVertical: spacing.xs, width: "100%", maxWidth: contentWidth, alignSelf: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 48 }}>
          {back ? (
            <IconButton icon="chevron-back" label="Go back" variant="plain"
              onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/library")} />
          ) : (
            <BrandLockup />
          )}
          {action}
        </View>
      </View>
      <ScrollView
        ref={scrollRef}
        style={Platform.OS === "web" && disableBrowserScrollAnchoring ? { overflowAnchor: "none" } as ViewStyle : undefined}
        onContentSizeChange={onContentSizeChange}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.action} colors={[c.action]} />
          ) : undefined
        }
        scrollEventThrottle={onScroll ? 100 : onEndReached ? 200 : undefined}
        onScroll={onScroll || onEndReached ? event => {
          onScroll?.(event);
          const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
          if (onEndReached && layoutMeasurement.height + contentOffset.y >= contentSize.height - 600) onEndReached();
        } : undefined}
        contentContainerStyle={{
          paddingTop: spacing.md,
          paddingBottom: (footer ? spacing.lg : insets.bottom + spacing.xl),
          paddingHorizontal: spacing.lg - 4,
          gap: spacing.lg,
          width: "100%",
          maxWidth: contentWidth,
          alignSelf: "center",
        }}
      >
        <View style={{ gap: 6 }}>
          {!!eyebrow && <Copy kind="caption" tone="accent">{eyebrow}</Copy>}
          <Copy kind="title">{title}</Copy>
          {!!subtitle && <Copy tone="muted">{subtitle}</Copy>}
        </View>
        {children}
      </ScrollView>
      {!!footer && (
        <View
          style={{
            ...(constrainFooter ? { flexShrink: 1, minHeight: 0 } : {}),
            paddingHorizontal: spacing.lg - 4,
            paddingTop: spacing.sm,
            paddingBottom: Math.max(insets.bottom, spacing.sm) + 4,
            borderTopWidth: 1,
            borderTopColor: c.border,
            backgroundColor: c.surface,
          }}
        >
          <View style={{ ...(constrainFooter ? { flexShrink: 1, minHeight: 0 } : {}), width: "100%", maxWidth: contentWidth, alignSelf: "center", gap: spacing.xs }}>{footer}</View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

export type CardTone = "plain" | "hero" | "sunken" | "accent";
/** Grouped content. `hero` is the one brand-coloured card per screen (e.g. today's session). */
export function Card({
  children,
  tone = "plain",
  onPress,
  accessibilityLabel,
  compact = false,
  style,
}: PropsWithChildren<{
  tone?: CardTone;
  onPress?: () => void;
  accessibilityLabel?: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}>) {
  const c = useColors();
  const reduced = useReducedMotion();
  const bg = { plain: c.surface, hero: c.hero, sunken: c.sunken, accent: c.accentSoft }[tone];
  const base: ViewStyle = {
    padding: compact ? spacing.md : spacing.lg - 4,
    gap: compact ? spacing.sm : spacing.md - 2,
    borderRadius: radii.xl - 4,
    backgroundColor: bg,
    borderWidth: tone === "plain" ? 1 : 0,
    borderColor: c.border,
    shadowColor: c.shadow,
    ...(tone === "hero" ? elevation.raised : tone === "plain" ? elevation.card : elevation.none),
  };
  const content = <SurfaceProvider value={tone === "hero" ? "hero" : "default"}>{children}</SurfaceProvider>;
  if (!onPress) return <View style={[base, style]}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        base,
        { transform: [{ scale: pressed && !reduced ? 0.985 : 1 }], opacity: pressed && reduced ? 0.85 : 1 },
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

/**
 * Image-led card for workouts (Library, Discover). Falls back to a branded
 * placeholder when there's no thumbnail.
 */
export function MediaCard({
  title,
  meta,
  image,
  chips = [],
  badge,
  onPress,
  layout = "row",
  accessibilityLabel,
  icon,
  placeholder,
  footer,
}: {
  title: string;
  meta?: string;
  image?: string | null;
  /** Placeholder glyph when there's no thumbnail (defaults to the brand mark). */
  icon?: IconName;
  /** Custom artwork when there's no thumbnail (fills the thumbnail frame). */
  placeholder?: ReactNode;
  /** Extra line under the chips (e.g. creator credit). */
  footer?: ReactNode;
  chips?: string[];
  badge?: string;
  onPress?: () => void;
  layout?: "row" | "stacked";
  accessibilityLabel?: string;
}) {
  const c = useColors();
  const reduced = useReducedMotion();
  const stacked = layout === "stacked";
  const thumb = (
    <View
      style={{
        width: stacked ? "100%" : 92,
        height: stacked ? 168 : 92,
        borderRadius: radii.lg - 4,
        overflow: "hidden",
        backgroundColor: image ? c.sunken : c.actionSoft,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {image ? (
        <Image
          source={{ uri: image }}
          contentFit="cover"
          transition={reduced ? 0 : motion.base}
          style={{ width: "100%", height: "100%" }}
          accessibilityIgnoresInvertColors
        />
      ) : placeholder ? (
        placeholder
      ) : icon ? (
        <Ionicons name={icon} size={stacked ? 40 : 30} color={c.onActionSoft} />
      ) : (
        <BrandMark height={stacked ? 40 : 26} />
      )}
      {!!badge && stacked && (
        <View style={{ position: "absolute", top: 8, left: 8 }}>
          <Chip label={badge} tone="accent" />
        </View>
      )}
    </View>
  );
  return (
    <Card onPress={onPress} accessibilityLabel={accessibilityLabel ?? [title, meta].filter(Boolean).join(", ")} compact>
      <View style={{ flexDirection: stacked ? "column" : "row", gap: spacing.md - 2, alignItems: stacked ? "stretch" : "center" }}>
        {thumb}
        <View style={{ flex: stacked ? undefined : 1, gap: 6, minWidth: 0 }}>
          <Copy kind="subheading" numberOfLines={2}>
            {title}
          </Copy>
          {!!meta && (
            <Copy kind="small" tone="muted" numberOfLines={2}>
              {meta}
            </Copy>
          )}
          {(!!chips.length || (!!badge && !stacked)) && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {!!badge && !stacked && <Chip label={badge} tone="accent" />}
              {chips.slice(0, 3).map((chip) => (
                <Chip key={chip} label={chip} />
              ))}
            </View>
          )}
          {footer}
        </View>
      </View>
    </Card>
  );
}

/** Compact tappable row: settings, secondary actions, sheet actions. */
export function ListRow({
  title,
  detail,
  icon,
  value,
  onPress,
  destructive = false,
  trailing = "chevron",
  disabled = false,
}: {
  title: string;
  detail?: string;
  icon?: IconName;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  trailing?: "chevron" | "external" | "none";
  disabled?: boolean;
}) {
  const c = useColors();
  const surface = useSurface();
  const fg = destructive ? c.error : surface === "hero" ? c.onHero : c.text;
  const body = (
    <>
      {!!icon && (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radii.md - 2,
            backgroundColor: destructive ? c.errorSoft : surface === "hero" ? c.onHeroSoft : c.actionSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={icon} size={21} color={destructive ? c.error : surface === "hero" ? c.onHero : c.onActionSoft} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Copy kind="label" color={fg}>
          {title}
        </Copy>
        {!!detail && (
          <Copy kind="small" tone="muted">
            {detail}
          </Copy>
        )}
      </View>
      {!!value && (
        <Copy kind="small" tone="muted">
          {value}
        </Copy>
      )}
      {!!onPress && trailing !== "none" && (
        <Ionicons
          name={trailing === "external" ? "open-outline" : "chevron-forward"}
          size={18}
          color={surface === "hero" ? c.heroMuted : c.muted}
        />
      )}
    </>
  );
  const style: ViewStyle = { minHeight: 56, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 14 };
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole={trailing === "external" ? "link" : "button"}
      accessibilityLabel={detail ? `${title}. ${detail}` : title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [style, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

/** Groups ListRows inside one card with hairline separators. */
export function ListGroup({ children }: PropsWithChildren) {
  const c = useColors();
  // Flatten arrays and fragments so every row gets its own separator.
  const flatten = (nodes: ReactNode): ReactNode[] =>
    Children.toArray(nodes).flatMap((child) =>
      isValidElement(child) && child.type === Fragment
        ? flatten((child as ReactElement<{ children?: ReactNode }>).props.children)
        : [child]
    );
  const items = flatten(children);
  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: radii.xl - 4,
        borderWidth: 1,
        borderColor: c.border,
        paddingHorizontal: spacing.md,
        paddingVertical: 4,
      }}
    >
      {items.map((child, i) => (
        <View key={(isValidElement(child) && child.key) || i} style={i ? { borderTopWidth: 1, borderTopColor: c.border } : null}>
          {child}
        </View>
      ))}
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: { label: string; onPress(): void } }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: -8 }}>
      <Copy kind="heading">{title}</Copy>
      {!!action && (
        <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} hitSlop={12}>
          <Copy kind="label" color={c.onActionSoft}>
            {action.label}
          </Copy>
        </Pressable>
      )}
    </View>
  );
}

export type NoticeTone = "info" | "error" | "success" | "warning";
const noticeIcons: Record<NoticeTone, IconName> = {
  info: "information-circle-outline",
  error: "alert-circle-outline",
  success: "checkmark-circle-outline",
  warning: "warning-outline",
};
export function Notice({
  children,
  error = false,
  tone,
}: PropsWithChildren<{ error?: boolean; tone?: NoticeTone }>) {
  const c = useColors();
  const kind: NoticeTone = tone ?? (error ? "error" : "info");
  const fg = { info: c.muted, error: c.error, success: c.success, warning: c.warning }[kind];
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        paddingVertical: 12,
        paddingHorizontal: 14,
        gap: 10,
        borderRadius: radii.md,
        backgroundColor: kind === "error" ? c.errorSoft : c.sunken,
        flexDirection: "row",
        alignItems: "flex-start",
      }}
    >
      <Ionicons name={noticeIcons[kind]} size={20} color={fg} style={{ marginTop: 1 }} />
      <Copy kind="small" color={kind === "info" ? c.text : fg} style={{ flex: 1 }}>
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
  mark = false,
}: {
  icon: IconName;
  title: string;
  description: string;
  action?: ReactNode;
  /** Show the brand mark instead of an icon (first-run moments). */
  mark?: boolean;
}) {
  const c = useColors();
  return (
    <Card>
      {mark ? (
        <BrandMark height={36} />
      ) : (
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: radii.lg - 4,
            backgroundColor: c.actionSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={icon} color={c.onActionSoft} size={26} />
        </View>
      )}
      <Copy kind="heading">{title}</Copy>
      <Copy tone="muted">{description}</Copy>
      {action}
    </Card>
  );
}

/** Placeholder while content is actively loading. Pulses unless Reduce Motion is on. */
export function Skeleton({ height = 16, width = "100%", radius = radii.sm }: { height?: number; width?: ViewStyle["width"]; radius?: number }) {
  const c = useColors();
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== "web" }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return (
    <Animated.View
      style={{ height, width, borderRadius: radius, backgroundColor: c.skeleton, opacity: reduced ? 0.8 : pulse }}
    />
  );
}
export function SkeletonCard({ lines = 2, label = "Loading" }: { lines?: number; label?: string }) {
  return (
    <View accessible accessibilityLabel={label} accessibilityRole="progressbar">
      <Card>
        <Skeleton height={22} width="60%" />
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} height={14} width={i === lines - 1 ? "40%" : "90%"} />
        ))}
      </Card>
    </View>
  );
}

/** Bottom sheet for quick actions. Keeps the current screen in view behind it. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: PropsWithChildren<{ visible: boolean; onClose(): void; title: string }>) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduced ? "fade" : "slide"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: c.overlay }}
        />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: c.elevated,
            borderTopLeftRadius: radii.xl,
            borderTopRightRadius: radii.xl,
            paddingHorizontal: spacing.lg - 4,
            paddingTop: spacing.sm,
            paddingBottom: insets.bottom + spacing.md,
            gap: spacing.sm,
            maxHeight: "85%",
            shadowColor: c.shadow,
            ...elevation.overlay,
          }}
        >
          <View style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: c.border }} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Copy kind="heading">{title}</Copy>
            <IconButton icon="close" label={`Close ${title}`} onPress={onClose} size={40} />
          </View>
          <ScrollView contentContainerStyle={{ gap: spacing.xs, paddingBottom: 4 }}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

type ToastMessage = { id: number; text: string; tone: NoticeTone };
const ToastContext = createContext<(text: string, tone?: NoticeTone) => void>(() => undefined);
export function useToast() {
  return useContext(ToastContext);
}
/** Brief confirmation that doesn't interrupt (e.g. "Saved to your library"). */
export function ToastProvider({ children }: PropsWithChildren) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const show = useCallback((text: string, tone: NoticeTone = "success") => {
    setToast({ id: Date.now(), text, tone });
  }, []);
  useEffect(() => {
    if (!toast) return;
    opacity.setValue(reduced ? 1 : 0);
    if (!reduced) Animated.timing(opacity, { toValue: 1, duration: motion.base, useNativeDriver: Platform.OS !== "web" }).start();
    const timer = setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), 2800);
    return () => clearTimeout(timer);
  }, [toast, opacity, reduced]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {!!toast && (
        <Animated.View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          pointerEvents="none"
          style={{
            position: "absolute",
            left: spacing.md,
            right: spacing.md,
            bottom: insets.bottom + 72,
            alignItems: "center",
            opacity,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              maxWidth: contentWidth,
              paddingVertical: 12,
              paddingHorizontal: 16,
              borderRadius: radii.full,
              backgroundColor: c.text,
              shadowColor: c.shadow,
              ...elevation.raised,
            }}
          >
            <Ionicons name={noticeIcons[toast.tone]} size={20} color={c.background} />
            <Copy kind="label" color={c.background} style={{ flexShrink: 1 }}>
              {toast.text}
            </Copy>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

/** Chat bubble for coach conversations. */
export function Bubble({ from, children, meta }: PropsWithChildren<{ from: "you" | "coach"; meta?: string }>) {
  const c = useColors();
  const you = from === "you";
  return (
    <View style={{ alignItems: you ? "flex-end" : "flex-start", gap: 4 }}>
      <View
        style={{
          maxWidth: "88%",
          width: you ? undefined : "88%",
          paddingVertical: 12,
          paddingHorizontal: 16,
          gap: 6,
          borderRadius: radii.lg,
          borderBottomRightRadius: you ? 6 : radii.lg,
          borderBottomLeftRadius: you ? radii.lg : 6,
          backgroundColor: you ? c.actionSoft : c.surface,
          borderWidth: you ? 0 : 1,
          borderColor: c.border,
        }}
      >
        {!you && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <BrandMark height={12} />
            <Copy kind="caption" tone="muted">
              Your AI coach
            </Copy>
          </View>
        )}
        {children}
      </View>
      {!!meta && (
        <Copy kind="small" tone="muted" style={{ fontSize: 12 }}>
          {meta}
        </Copy>
      )}
    </View>
  );
}
