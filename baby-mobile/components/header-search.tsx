import { useContext, useEffect, useRef } from "react";
import { Platform } from "react-native";
import { Stack } from "expo-router";
import type { SearchBarCommands } from "react-native-screens";
import { Field, NativeHeaderContext, useColors } from "./ui";

/** UIKit owns search; keep route-driven clearing in sync without resetting typing. */
export function HeaderSearch({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const native = useContext(NativeHeaderContext) && Platform.OS !== "web", c = useColors(),
    ref = useRef<SearchBarCommands | null>(null), nativeText = useRef("");
  useEffect(() => {
    if (native && nativeText.current !== value) { ref.current?.setText(value); nativeText.current = value; }
  }, [native, value]);
  if (!native) return <Field label="Search" value={value} onChange={onChange} placeholder={placeholder} />;
  return <Stack.Screen options={{ headerSearchBarOptions: {
    // Stacked under the title: iOS 26 would otherwise float it over the list above our tab bar.
    ref, placeholder, placement: "stacked", hideWhenScrolling: false, hideNavigationBar: false, autoCapitalize: "none",
    tintColor: c.action, textColor: c.text, barTintColor: c.surface,
    onChangeText: event => { nativeText.current = event.nativeEvent.text; onChange(event.nativeEvent.text); },
    onCancelButtonPress: () => { nativeText.current = ""; onChange(""); },
  } }} />;
}
