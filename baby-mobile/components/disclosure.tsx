import { useState, type PropsWithChildren } from "react";
import { Pressable, View } from "react-native";
import { Copy, Icon, useColors } from "./ui";

/** Secondary detail stays available without taking over the reading flow. */
export function Disclosure({ title, startOpen = false, children }: PropsWithChildren<{ title: string; startOpen?: boolean }>) {
  const [open, setOpen] = useState(startOpen), c = useColors();
  return (
    <View style={{ gap: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={title}
        accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
        style={({ pressed }) => ({ minHeight: 48, paddingVertical: 8, flexDirection: "row", alignItems: "center",
          justifyContent: "space-between", gap: 12, borderBottomWidth: 1, borderColor: c.border,
          opacity: pressed ? 0.6 : 1 })}>
        <View style={{ flex: 1 }}><Copy kind="label">{title}</Copy></View>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={18} />
      </Pressable>
      {open && children}
    </View>
  );
}
