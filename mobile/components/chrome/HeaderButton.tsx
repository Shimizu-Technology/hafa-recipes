import { useState } from 'react';
import { ActionSheetIOS, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, useColors } from '@/components/Themed';

export const HEADER_BUTTON_SIZE = 36;

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** The one header action shape: a 36pt tonal circle with a label-colour glyph, inside a 44pt target. */
export function HeaderIconButton({ icon, accessibilityLabel, onPress, primary = false, testID }: {
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => void;
  /** Accent glyph for the screen's single primary action. */
  primary?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} testID={testID} hitSlop={4}
    style={({ pressed }) => [styles.target, pressed && { opacity: 0.6 }]}>
    <View style={[styles.circle, { backgroundColor: colors.surface2 }]}>
      <Ionicons name={icon} size={20} color={primary ? colors.actionText : colors.text} />
    </View>
  </Pressable>;
}

export type HeaderMenuAction = { title: string; onPress: () => void; destructive?: boolean };

/**
 * A ··· header button. iOS shows the system action sheet; Android and web get the same
 * choices in a bottom sheet, so no platform depends on a SwiftUI-only menu.
 */
export function HeaderMenuButton({ title, accessibilityLabel, actions }: { title?: string; accessibilityLabel: string; actions: HeaderMenuAction[] }) {
  const colors = useColors();
  const { bottom } = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const show = () => {
    if (Platform.OS !== 'ios') { setOpen(true); return; }
    const destructiveButtonIndex = actions.findIndex(action => action.destructive);
    ActionSheetIOS.showActionSheetWithOptions({
      title,
      options: [...actions.map(action => action.title), 'Cancel'],
      cancelButtonIndex: actions.length,
      destructiveButtonIndex: destructiveButtonIndex >= 0 ? destructiveButtonIndex : undefined,
    }, index => { actions[index]?.onPress(); });
  };
  const choose = (action: HeaderMenuAction) => { setOpen(false); action.onPress(); };
  return <>
    <HeaderIconButton icon="ellipsis-horizontal" accessibilityLabel={accessibilityLabel} onPress={show} />
    {Platform.OS !== 'ios' && <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable style={styles.scrim} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close menu">
        <Pressable style={[styles.sheet, { backgroundColor: colors.backgroundElevated, paddingBottom: bottom + 8 }]}>
          {title && <Text style={[styles.sheetTitle, { color: colors.textSecondary }]}>{title}</Text>}
          {actions.map(action => <Pressable key={action.title} onPress={() => choose(action)} accessibilityRole="button"
            style={({ pressed }) => [styles.sheetRow, pressed && { backgroundColor: colors.surface2 }]}>
            <Text style={{ fontSize: 17, lineHeight: 22, color: action.destructive ? colors.destructive : colors.text }}>{action.title}</Text>
          </Pressable>)}
        </Pressable>
      </Pressable>
    </Modal>}
  </>;
}

/**
 * Stack options for a header's trailing buttons. iOS 26 would wrap them in a shared glass capsule;
 * hiding it keeps the same tonal circles there as on iOS 18 and Android.
 */
export function headerRightOptions(render: () => React.ReactElement) {
  return {
    headerRight: render,
    unstable_headerRightItems: () => [{ type: 'custom' as const, element: <View style={styles.row}>{render()}</View>, hidesSharedBackground: true }],
  };
}

const styles = StyleSheet.create({
  target: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  circle: { width: HEADER_BUTTON_SIZE, height: HEADER_BUTTON_SIZE, borderRadius: HEADER_BUTTON_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.32)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 },
  sheetTitle: { fontSize: 13, lineHeight: 18, paddingHorizontal: 20, paddingVertical: 8 },
  sheetRow: { minHeight: 52, justifyContent: 'center', paddingHorizontal: 20 },
});
