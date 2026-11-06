import { Linking, View } from "react-native";
import { router } from "expo-router";
import { cdcUrgentClosing, cdcUrgentOpening, cdcUrgentSigns, cdcWarningSignsSource, cdcWarningSignsUrl, helpLines } from "@/lib/medical-wording";
import { useBabyIfSignedIn } from "@/lib/context";
import { callLines, nextContactPrompt } from "../lib/contacts";
import { profileToday } from "@/lib/timing";
import { Button, Copy, QuietRow, Screen, Section, useToast } from "@/components/ui";
import { CallContact } from "@/components/call-contact";
import { canChangeBaby } from "../lib/spaces";
import { Disclosure } from "@/components/disclosure";
import { MedicalSource } from "@/components/medical-source";

/**
 * AWAITING CLINICIAN REVIEW (MEDICAL_REVIEW section A). CDC's urgent signs and numbers to call, and nothing of ours.
 * It asks the network for nothing, so it opens with no signal, however the app is doing. The only account data is her own
 * numbers, as this phone last had them; with no account it's just the rest. They go under 911, and what's below them is unchanged.
 */
export default function Help() {
  const toast = useToast(),
    open = (url: string, label: string) => void Linking.openURL(url).catch(() => toast(`This device couldn’t do that. ${label.replace(/^(Call|Text) /, "The number is ")}.`)),
    bootstrap = useBabyIfSignedIn()?.state.bootstrap,
    today = profileToday(new Date(), bootstrap?.profile.timezone),
    prompt = nextContactPrompt(bootstrap, today, (child) => canChangeBaby(bootstrap, child));
  return <Screen title="Help" back>
    <View style={{ gap: 18 }}>
      {helpLines.map((line, place) => <View key={line.name} style={{ gap: 18 }}><View style={{ gap: 8 }}>
        {line.name !== "911" && <Copy kind="label">{line.name}</Copy>}
        {line.actions.map((action, index) => <Button key={action.url} numeric secondary={index > 0 || line.name !== "911"} title={action.label} onPress={() => open(action.url, action.label)} />)}
        {!!line.note && <Copy kind="small" tone="muted">{line.note}</Copy>}
        {!!line.source && <MedicalSource source={line.source.name} url={line.source.url} />}
      </View>
      {place === 0 && callLines(bootstrap, today).map((call) => <CallContact key={call.key} line={call} />)}
      {place === 0 && !!prompt && <QuietRow title={prompt.title} onPress={() => router.push(prompt.child ? { pathname: "/child", params: { id: prompt.child, doctor: "1" } } : { pathname: "/profile", params: { open: prompt.open } })} />}
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
