import { Linking, View } from "react-native";
import { cdcUrgentClosing, cdcUrgentOpening, cdcUrgentSigns, cdcWarningSignsSource, cdcWarningSignsUrl, helpLines } from "@/lib/medical-wording";
import { Button, Copy, Screen, Section, useToast } from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { MedicalSource } from "@/components/medical-source";

/**
 * AWAITING CLINICIAN REVIEW (MEDICAL_REVIEW section A). CDC's urgent signs and numbers to call, and nothing of ours.
 * It reads no account data and asks the network for nothing, so it opens with no signal, however the app is doing.
 */
export default function Help() {
  const toast = useToast(),
    open = (url: string, label: string) => void Linking.openURL(url).catch(() => toast(`This device couldn’t do that. ${label.replace(/^(Call|Text) /, "The number is ")}.`));
  return <Screen title="Help" back>
    <View style={{ gap: 18 }}>
      {helpLines.map((line) => <View key={line.name} style={{ gap: 8 }}>
        {line.name !== "911" && <Copy kind="label">{line.name}</Copy>}
        {line.actions.map((action, index) => <Button key={action.url} numeric secondary={index > 0 || line.name !== "911"} title={action.label} onPress={() => open(action.url, action.label)} />)}
        {!!line.note && <Copy kind="small" tone="muted">{line.note}</Copy>}
        {!!line.source && <MedicalSource source={line.source.name} url={line.source.url} />}
      </View>)}
    </View>
    <Section title="Urgent maternal warning signs">
      <Copy>{cdcUrgentOpening}</Copy>
      <View style={{ gap: 4 }}>
        {cdcUrgentSigns.map((sign) => <Disclosure key={sign.title} title={sign.title}><Copy>{sign.detail}</Copy></Disclosure>)}
      </View>
      <Copy>{cdcUrgentClosing}</Copy>
      <MedicalSource source={cdcWarningSignsSource} url={cdcWarningSignsUrl} />
    </Section>
  </Screen>;
}
