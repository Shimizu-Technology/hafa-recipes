import { HealthNote } from "../components/health-note";
import { Linking, View } from "react-native";
import { router } from "expo-router";
import { cdcUrgentClosing, cdcUrgentOpening, cdcUrgentSigns, cdcWarningSignsSource, cdcWarningSignsUrl, helpLines, babyFeverLine, babyFeverUrl, babyIllnessUrl, babyBreathingUrl, babyEmergencySigns, newbornErSigns, feedingWarningSigns, babyTemperatureNote, cdcReuseNote } from "@/lib/medical-wording";
import { useBabyIfSignedIn } from "@/lib/context";
import { callLines, nextContactPrompt } from "../lib/contacts";
import { profileToday } from "@/lib/timing";
import { Button, Copy, QuietRow, Screen, Section, useToast } from "@/components/ui";
import { CallContact } from "@/components/call-contact";
import { canChangeBaby } from "../lib/spaces";
import { Disclosure } from "@/components/disclosure";
import { MedicalSource } from "@/components/medical-source";

/** Fixed help works offline. Saved care contacts, when available, stay below the urgent numbers. */
export default function Help() {
  const toast = useToast(),
    open = (url: string, label: string) => void Linking.openURL(url).catch(() => toast(`This device couldn’t do that. ${label.replace(/^(Call|Text) /, "The number is ")}.`)),
    bootstrap = useBabyIfSignedIn()?.state.bootstrap,
    today = profileToday(new Date(), bootstrap?.profile.timezone),
    prompt = nextContactPrompt(bootstrap, today, (child) => canChangeBaby(bootstrap, child));
  return <Screen title="Help" back>
    <View style={{ gap: 18 }}>
      {helpLines.map((line) => <View key={line.name} style={{ gap: 8 }}>
        {line.name !== "911" && <Copy kind="label">{line.name}</Copy>}
        {line.actions.map((action, index) => <Button key={action.url} numeric secondary={index > 0 || line.name !== "911"} title={action.label} onPress={() => open(action.url, action.label)} />)}
        {!!line.note && <Copy kind="small" tone="muted">{line.note}</Copy>}
        {!!line.source && <MedicalSource source={line.source.name} url={line.source.url} />}
      </View>)}
      {callLines(bootstrap, today).map((call) => <CallContact key={call.key} line={call} />)}
      {!!prompt && <QuietRow title={prompt.title} onPress={() => router.push(prompt.child ? { pathname: "/child", params: { id: prompt.child, doctor: "1" } } : { pathname: "/profile", params: { open: prompt.open } })} />}
    </View>
    <Section title="When your baby seems unwell">
      <Copy kind="label">Call 911 now for these baby emergency signs</Copy>
      <Button title="Call 911 now for your baby" onPress={() => open("tel:911", "Call 911")} />
      {babyEmergencySigns.map((sign) => <Copy key={sign}>{`• ${sign}`}</Copy>)}
      <MedicalSource source="AAP, newborn emergency signs" url={babyIllnessUrl} />
      <MedicalSource source="AAP, breathing trouble" url={babyBreathingUrl} />
      <Copy kind="label">Go to the ER now for these baby signs</Copy>
      {newbornErSigns.map((sign) => <Copy key={sign}>{`• ${sign}`}</Copy>)}
      <MedicalSource source="AAP, when a newborn needs the ER" url={babyIllnessUrl} />
      <Copy>Call your baby’s doctor now if your baby seems sick or hurt. This is not every warning sign.</Copy>
      <Copy>{babyFeverLine}</Copy>
      <Copy>{babyTemperatureNote}</Copy>
      <MedicalSource source="AAP, fever and your baby" url={babyFeverUrl} />
      <MedicalSource source="AAP, fever in a young baby" url={babyIllnessUrl} />
      <Copy>Blood in poop, or white, grey or unusually pale poop, needs your baby’s doctor. Call them rather than waiting for a pattern in the logs.</Copy>
      <MedicalSource source="AAP, stool colours" url="https://www.healthychildren.org/English/ages-stages/baby/Pages/The-Many-Colors-of-Poop.aspx" />
      <Copy kind="label">Feeding and diaper warning signs</Copy>
      <Copy>CDC lists these concerns for newborn breastfeeding. Speak to your baby’s doctor right away if you are worried. These are warning signs, not a feeding schedule or a verdict from your logs.</Copy>
      {feedingWarningSigns.map((sign) => <Copy key={sign}>{`• ${sign}`}</Copy>)}
      <Copy>These logs cannot tell you that your baby is okay.</Copy>
      <MedicalSource source="CDC, newborn breastfeeding basics" url="https://www.cdc.gov/infant-toddler-nutrition/breastfeeding/newborn-basics.html" />
    </Section>
    <Section title="Urgent maternal warning signs">
      <Copy>{cdcUrgentOpening}</Copy>
      <View style={{ gap: 4 }}>
        {cdcUrgentSigns.map((sign) => <Disclosure key={sign.title} title={sign.title}><Copy>{sign.detail}</Copy></Disclosure>)}
      </View>
      <Copy>{cdcUrgentClosing}</Copy>
      <MedicalSource source={cdcWarningSignsSource} url={cdcWarningSignsUrl} />
      <Copy kind="small" tone="muted">{cdcReuseNote}</Copy>
    </Section>

    <HealthNote />
  </Screen>;
}
