import { useRef } from "react";
import { TextInput, View, useWindowDimensions } from "react-native";
import { Icon, PressTarget, fonts, radii, useColors } from "./ui";

/**
 * Search drawn by the app, not UIKit: a white (warm-dark at night) field on the sand page with a search glyph and a
 * clear button. UIKit's search field stays system grey on sand and differs between iOS 18 and 26; this one is the
 * same everywhere and scales with text size. It scrolls with the list instead of sitting under the large title.
 */
export function HeaderSearch({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), input = useRef<TextInput>(null);
  return <View style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 14, paddingRight: value ? 4 : 14,
    borderRadius: radii.field, backgroundColor: c.surface }}>
    <Icon name="search" size={19} color={c.muted} />
    <TextInput
      key={fontScale}
      ref={input}
      accessibilityLabel={placeholder}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={c.muted}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="search"
      enablesReturnKeyAutomatically
      maxLength={200}
      maxFontSizeMultiplier={0}
      selectionColor={c.accentText}
      style={{ flex: 1, minHeight: 48, paddingVertical: 12, fontFamily: fonts.regular, fontSize: 17, lineHeight: 22, color: c.text }}
    />
    {!!value && <PressTarget accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={4}
      onPress={() => { onChange(""); input.current?.focus(); }}
      style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
      <Icon name="close-circle" size={19} color={c.muted} />
    </PressTarget>}
  </View>;
}
