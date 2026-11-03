import { useRef, useState } from "react";
import { Text, TextInput, View, useWindowDimensions } from "react-native";
import { Icon, PressTarget, fonts, radii, useColors } from "./ui";

/**
 * Search drawn by the app, not UIKit: a white (warm-dark at night) field on the sand page with a search glyph and a
 * clear button. UIKit's search field stays system grey on sand and differs between iOS 18 and 26; this one is the
 * same everywhere and scales with text size. It scrolls with the list instead of sitting under the large title.
 * While typing, Cancel clears the search and closes the keyboard, as UIKit's search bar did.
 */
export function HeaderSearch({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), input = useRef<TextInput>(null), [focused, setFocused] = useState(false);
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
  <View style={{ flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 14, paddingRight: value ? 4 : 14,
    borderRadius: radii.field, backgroundColor: c.surface }}>
    <Icon name="search" size={19} color={c.muted} />
    <TextInput
      key={fontScale}
      ref={input}
      accessibilityLabel={placeholder}
      value={value}
      onChangeText={onChange}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      placeholderTextColor={c.muted}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="search"
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
  </View>
  {focused && <PressTarget accessibilityRole="button" accessibilityLabel="Cancel search"
    onPress={() => { onChange(""); input.current?.blur(); }}
    style={{ minWidth: 44, minHeight: 44, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" }}>
    <Text key={fontScale} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, color: c.action }}>Cancel</Text>
  </PressTarget>}
  </View>;
}
