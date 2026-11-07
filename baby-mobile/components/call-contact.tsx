import { Linking, View, useWindowDimensions } from "react-native";
import { callLabel, dialUrl, type CallLine } from "../lib/contacts";
import { Button, Copy, useToast } from "@/components/ui";

/** A phone link labelled with what she typed. It says nothing about when to call. */
export function CallContact({ line }: { line: CallLine }) {
  const toast = useToast(), { fontScale } = useWindowDimensions(), url = dialUrl(line.contact.phone), { name, phone } = line.contact,
    // At the largest sizes a number in the button breaks mid-digits, so it goes under the button, where the smaller text fits.
    apart = fontScale >= 2;
  if (!url) return null;
  return <View style={{ gap: 8 }}>
    <Copy kind="label">{line.heading}</Copy>
    <Button numeric secondary title={apart ? (name?.trim() ? `Call ${name.trim()}` : "Call") : callLabel(line.contact)} accessibilityLabel={callLabel(line.contact).replace("\n", ", ")}
      onPress={() => void Linking.openURL(url).catch(() => toast(`This device couldn’t do that. The number is ${phone}.`))} />
    {apart && <Copy numeric kind="small" tone="muted">{phone}</Copy>}
  </View>;
}
