import { Linking } from "react-native";
import { Button, Copy, Screen, Section, useToast } from "@/components/ui";
import { MedicalSource } from "@/components/medical-source";
import { Disclosure } from "@/components/disclosure";

const sources = [
  ["CDC: maternal warning signs", "https://www.cdc.gov/hearher/maternal-warning-signs/index.html"],
  ["CDC: developmental milestones", "https://www.cdc.gov/act-early/milestones/index.html"],
  ["CDC: growth charts", "https://www.cdc.gov/growth-chart-training/hcp/using-growth-charts/who-using.html"],
  ["AAP: HealthyChildren", "https://www.healthychildren.org/"],
  ["ACOG: pregnancy information", "https://www.acog.org/womens-health"],
  ["NIH: MedlinePlus", "https://medlineplus.gov/"],
  ["WHO: child growth standards", "https://www.who.int/tools/child-growth-standards"],
  ["Nemours KidsHealth", "https://kidshealth.org/"],
  ["Cleveland Clinic", "https://my.clevelandclinic.org/"],
  ["March of Dimes", "https://www.marchofdimes.org/"],
  ["NHS", "https://www.nhs.uk/"],
  ["FDA: medicines", "https://www.fda.gov/drugs"],
  ["988 Lifeline", "https://988lifeline.org/"],
  ["HRSA: maternal mental health hotline", "https://mchb.hrsa.gov/programs-impact/national-maternal-mental-health-hotline"],
];
export default function HealthInformation() {
  const toast = useToast();
  return <Screen title="About the health information" back>
    <Button title="Call 911 in an emergency" onPress={() => void Linking.openURL("tel:911").catch(() => toast("Call 911 from your phone."))} />
    <Copy>Håfa Baby gives general information, not medical advice. Always check health information and care decisions with your doctor or your baby’s doctor.</Copy>
    <Copy>The health wording has not been reviewed by a clinician. An AI agent checked the public sources on November 7, 2026, at Leon’s request for private family use. That is not a medical review.</Copy>
    <Copy>Sources can change or disagree. The app cannot diagnose, give medicine doses, or tell you that you or your baby are okay. Counts, timers and growth charts keep records; they do not assess health.</Copy>
    <Section title="Public sources">
      <Copy>Bundled information was written from these public sources. Each card links to its specific sources. Ask may make mistakes: check the original. Saved posts and your own notes have not been medically verified.</Copy>
      <Disclosure title="Sources and links">{sources.map(([source, url]) => <MedicalSource key={url} source={source} url={url} />)}</Disclosure>
    </Section>
    <Section title="Private family use">
      <Copy>This version is for the family. Before any public or paid release, the wording needs clinician review and the WHO charts need permission. Agent review does not meet those gates.</Copy>
    </Section>
  </Screen>;
}
