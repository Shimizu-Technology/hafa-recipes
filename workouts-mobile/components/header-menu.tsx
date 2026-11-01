import { ActionSheetIOS, Platform, useColorScheme } from "react-native";
import { HeaderButton } from "./design/controls";
import { useColors } from "./design/foundation";
export type HeaderMenuItem = { title: string; onPress(): void; disabled?: boolean };
/** ··· menu: the system action sheet on iOS (any version), the screen's own bottom sheet elsewhere. */
export function HeaderMenu({ items, onFallback }: { items: HeaderMenuItem[]; onFallback(): void }) {
  const c = useColors();
  const scheme = useColorScheme();
  function open() {
    if (Platform.OS !== "ios" || !items.length) return onFallback();
    ActionSheetIOS.showActionSheetWithOptions({
      options: [...items.map(item => item.title), "Cancel"],
      cancelButtonIndex: items.length,
      disabledButtonIndices: items.flatMap((item, index) => item.disabled ? [index] : []),
      tintColor: c.accentText,
      userInterfaceStyle: scheme === "dark" ? "dark" : "light",
    }, index => { if (index < items.length && !items[index].disabled) items[index].onPress(); });
  }
  return <HeaderButton icon="ellipsis-horizontal" label="More options" onPress={open} />;
}
