import { Button, Host, Menu } from "@expo/ui/swift-ui";
import { accessibilityLabel, disabled, frame, labelStyle } from "@expo/ui/swift-ui/modifiers";
import { useColors } from "./design/foundation";
export type HeaderMenuItem = { title: string; onPress(): void; disabled?: boolean };
/** iOS draws the menu and its presentation; other platforms keep the existing sheet. */
export function HeaderMenu({ items }: { items: HeaderMenuItem[]; onFallback(): void }) {
  const c = useColors();
  return <Host seedColor={c.accent} style={{ width: 44, height: 44 }}>
    <Menu label="More options" systemImage="ellipsis" modifiers={[labelStyle("iconOnly"), frame({ width: 44, height: 44 }), accessibilityLabel("More options")]}>
      {items.map(item => <Button key={item.title} label={item.title} onPress={item.onPress} modifiers={[disabled(!!item.disabled)]} />)}
    </Menu>
  </Host>;
}
