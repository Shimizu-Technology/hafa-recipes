import { useRef } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FLOATING_HEIGHT, Icon, PressTarget, fonts, radii, tap, typeScale, useColors, type IconName } from "./ui";
import { HeaderIconButton } from "./tab-stack";

/** One choice in a detail page's ⋯ menu. Destructive ones are drawn in the error colour and confirm before they act. */
export interface MenuAction { title: string; icon: IconName; onPress: () => void; destructive?: boolean; detail?: string }

/** The floating Ask pill's height; Screen leaves this much room (plus a gap) under the content. */
const ASK_BUTTON_HEIGHT = FLOATING_HEIGHT;

/**
 * Choices as a sheet the app draws itself: the same Soft surface on iOS 18, iOS 26 and Android, instead of
 * the system action sheet, which changes look between iOS versions. A choice runs once the sheet has gone,
 * so a confirmation alert or the next screen never collides with it closing.
 */
export function ActionSheet({ visible, title, message, actions, onClose, cancelTitle = "Cancel" }: {
  visible: boolean; title?: string; message?: string; actions: MenuAction[]; onClose: () => void; cancelTitle?: string;
}) {
  const c = useColors(), { bottom } = useSafeAreaInsets(), { fontScale, height } = useWindowDimensions(),
    pending = useRef<(() => void) | null>(null);
  function flush() { const run = pending.current; pending.current = null; run?.(); }
  function choose(action: MenuAction) {
    tap();
    pending.current = action.onPress;
    onClose();
    // iOS reports the dismissal; elsewhere (and if it never does) the choice runs just after.
    setTimeout(flush, Platform.OS === "ios" ? 400 : 0);
  }
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onDismiss={flush} onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: "flex-end", paddingHorizontal: 8, paddingBottom: Math.max(bottom, 8) }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={onClose}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim }} />
      <View accessibilityViewIsModal style={{ width: "100%", maxWidth: 560, alignSelf: "center", gap: 8 }}>
        <View style={{ borderRadius: radii.grouped, backgroundColor: c.surface, overflow: "hidden", maxHeight: height * 0.75 }}>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
            {(!!title || !!message) && <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 4 }}>
              {!!title && <Text key={fontScale} accessibilityRole="header" maxFontSizeMultiplier={2}
                style={{ ...typeScale.subhead, fontFamily: fonts.semibold, color: c.muted }}>{title}</Text>}
              {!!message && <Text key={`m${fontScale}`} maxFontSizeMultiplier={2} style={{ ...typeScale.footnote, color: c.muted }}>{message}</Text>}
            </View>}
            {actions.map((action, index) => <View key={action.title}>
              {(index > 0 || !!title || !!message) && <View style={{ marginLeft: 56, height: 0.5, backgroundColor: c.border }} />}
              <PressTarget accessibilityRole="button" accessibilityLabel={[action.title, action.detail].filter(Boolean).join(". ")}
                onPress={() => choose(action)}
                style={{ minHeight: 56, paddingHorizontal: 20, paddingVertical: 14, flexDirection: "row", alignItems: "center", gap: 16 }}>
                <Icon name={action.icon} size={22} color={action.destructive ? c.error : c.accentText} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text key={fontScale} maxFontSizeMultiplier={2}
                    style={{ ...typeScale.headline, fontFamily: fonts.medium, color: action.destructive ? c.error : c.text }}>{action.title}</Text>
                  {!!action.detail && <Text key={`d${fontScale}`} maxFontSizeMultiplier={2} style={{ ...typeScale.footnote, color: c.muted }}>{action.detail}</Text>}
                </View>
              </PressTarget>
            </View>)}
          </ScrollView>
        </View>
        <PressTarget accessibilityRole="button" accessibilityLabel={cancelTitle} onPress={onClose}
          style={{ minHeight: 56, borderRadius: radii.grouped, backgroundColor: c.surface, alignItems: "center", justifyContent: "center", paddingVertical: 14 }}>
          <Text key={fontScale} maxFontSizeMultiplier={2} style={{ ...typeScale.headline, color: c.text }}>{cancelTitle}</Text>
        </PressTarget>
      </View>
    </View>
  </Modal>;
}

/** The ⋯ button at the top right of a detail page. The page draws its sheet, so the menu outlives header re-renders. */
export function MenuButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <HeaderIconButton icon="ellipsis-horizontal" label={label} onPress={onPress} />;
}

/**
 * Ask, floating at the bottom right of a detail page as Recipes does it: a white pill with a clay sparkle.
 * It folds to a circle at the largest text sizes so it never covers half the screen.
 */
export function AskButton({ label = "Ask about this", hint, onPress }: { label?: string; hint: string; onPress: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), compact = fontScale >= 1.5;
  return <PressTarget accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} onPress={() => { tap(); onPress(); }}
    style={{ height: ASK_BUTTON_HEIGHT, minWidth: ASK_BUTTON_HEIGHT, borderRadius: ASK_BUTTON_HEIGHT / 2, paddingLeft: compact ? 0 : 16, paddingRight: compact ? 0 : 20,
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: c.surface, borderWidth: 0.5, borderColor: c.outline,
      shadowColor: "#000000", shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 4 }}>
    <Icon name="sparkles" size={22} color={c.accentText} />
    {!compact && <Text key={fontScale} numberOfLines={1} maxFontSizeMultiplier={1.4} style={{ ...typeScale.callout, fontFamily: fonts.semibold, color: c.text }}>{label}</Text>}
  </PressTarget>;
}
