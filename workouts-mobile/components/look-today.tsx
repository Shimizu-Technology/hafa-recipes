import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { useLook } from "@/lib/look-context";
import { Copy, useColors } from "./design/foundation";
import { LookEntrance, LookPop } from "./design/look-motion";
import { BrandMark } from "./brand-mark";
import { useAccountIdentity } from "./account-identity";
import { ProgressRing } from "./design/training";
export function LookGreeting() {
  const look = useLook(), identity = useAccountIdentity(), c = useColors();
  if (look.id !== "coach") return null;
  const hour = new Date().getHours();
  return <LookEntrance><View style={{ gap: 8 }}>
    <BrandMark height={24} mono={c.text} />
    <Copy kind="title">Good {hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}{identity?.name ? `, ${identity.name.split(" ")[0]}` : ""}.</Copy>
    <Copy kind="small" tone="muted">A little movement. A little time for you.</Copy>
  </View></LookEntrance>;
}
export function LookTodayHero({ title, detail, meta, cover, action, extra }: { title: string; detail: string; meta?: string[]; cover?: string | null; action?: ReactNode; extra?: ReactNode }) {
  const look = useLook(), c = useColors();
  const coach = look.id === "coach";
  const [failed, setFailed] = useState<string | null>(null);
  return <LookEntrance index={1}><View style={{ backgroundColor: c.surface, borderRadius: look.radii.lg, overflow: "hidden", ...look.shadows }}>
    {look.id !== "pro" && <View style={{ height: coach ? 116 : 160, backgroundColor: c.sunken, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
      {cover && cover !== failed ? <Image source={{ uri: cover }} onError={() => setFailed(cover)} contentFit="cover" style={{ position: "absolute", inset: 0 }} /> : coach ? <LookPop trigger={title} kind="completion"><ProgressRing progress={title === "Done for today" ? 1 : 0} size={90} stroke={5} color={c.text}><BrandMark height={24} mono={c.text} /></ProgressRing></LookPop> : <View style={{ alignSelf: "stretch", paddingHorizontal: 24, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Copy kind="numeric" style={{ fontSize: 68, lineHeight: 74 }} maxScale={1.2}>{meta?.[0]?.match(/\d+/)?.[0] ?? "GO"}</Copy><View style={{ alignItems: "flex-end", gap: 12 }}><BrandMark height={27} mono={c.text} /><Copy kind="caption" tone="muted">{meta?.[0] ?? "Your next session"}</Copy></View></View>}
    </View>}
    <View style={{ padding: look.id === "pro" ? 20 : 22, gap: 12 }}>
      <Copy kind="caption" tone="muted">{look.id === "pro" ? "Today’s session" : coach ? "Made for your day" : "YOUR SESSION"}</Copy>
      <Copy kind={look.id === "athletic" ? "title" : "heading"}>{title}</Copy>
      {!!meta?.length && <Copy kind="small" tone="muted">{meta.join(" · ")}</Copy>}
      {!!detail && <Copy kind="small" tone="muted">{detail}</Copy>}
      {action}{extra}
    </View>
  </View></LookEntrance>;
}
