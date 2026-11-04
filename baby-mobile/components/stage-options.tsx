import { Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Card, Copy, Icon, PressTarget, radii, tap, typeScale, useColors } from "./ui";
import type { SetupStage } from "@/lib/child-setup";
import type { Child } from "@/lib/models";

const icons = { expecting: "calendar-outline", here: "heart-outline" } as const;

/** Still expecting or here: the same two big targets on Today and in setup. */
export function StageOptions({ labels, value, onChoose }: { labels: Record<SetupStage, string>; value?: SetupStage | null; onChoose: (stage: SetupStage) => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), choosing = value !== undefined;
  return <View accessibilityRole={choosing ? "radiogroup" : undefined} style={{ flexDirection: fontScale >= 1.3 ? "column" : "row", gap: 12 }}>
    {(["expecting", "here"] as const).map((stage) => {
      const on = value === stage;
      return <PressTarget key={stage} accessibilityRole={choosing ? "radio" : "button"} accessibilityLabel={labels[stage]}
        accessibilityState={choosing ? { selected: on, checked: on } : undefined}
        onPress={() => { if (!on) tap(); onChoose(stage); }}
        style={{ flex: fontScale >= 1.3 ? undefined : 1, minHeight: 92, paddingVertical: 16, paddingHorizontal: 10, borderRadius: radii.tile,
          backgroundColor: on ? c.action : c.surface, alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Icon name={icons[stage]} size={24} color={on ? c.onAction : c.accentText} />
        <Text key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.headline, color: on ? c.onAction : c.text, textAlign: "center" }}>{labels[stage]}</Text>
      </PressTarget>;
    })}
  </View>;
}

/** What Today leads with until it knows a date. No baby yet says why there's nothing to track; a named baby just needs its date. */
export function BabySetupCard({ child }: { child?: Child | null }) {
  const name = child?.name.trim(), { fontScale } = useWindowDimensions(), large = fontScale >= 1.5,
    why = <Copy tone="muted">{name ? "Add a due date or birth date and Today fills in." : "Feeds, kicks and everything else you can track start here once your baby has a profile."}</Copy>;
  return <Card tone="hero" style={{ gap: 14 }}>
    <Copy kind={large ? "label" : "heading"}>{name ? `Is ${name} here yet?` : "Is your baby here yet?"}</Copy>
    {/* At the largest text the choices can't wait below a screenful of words. */}
    {!large && why}
    <StageOptions labels={{ expecting: "I’m expecting", here: "Baby’s here" }}
      onChoose={(stage) => router.push({ pathname: "/child", params: { stage, ...(child ? { id: child.id } : {}) } })} />
    {large && why}
    {/* F7b's "join your family" line goes under these. */}
  </Card>;
}
