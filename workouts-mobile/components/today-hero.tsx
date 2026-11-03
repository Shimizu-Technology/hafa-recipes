import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { radii } from "@/constants/theme";
import { Copy, useColors } from "./design/foundation";
import { Entrance } from "./design/athletic-motion";
import { BrandMark } from "./brand-mark";

export function TodayHero({ title, detail, meta, cover, action, extra }: {
  title: string; detail: string; meta?: string[]; cover?: string | null; action?: ReactNode; extra?: ReactNode;
}) {
  const c = useColors();
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => setFailed(null), [cover]);
  return <Entrance><View style={{ backgroundColor: c.surface, borderRadius: radii.lg }}>
    <View style={{ height: 104, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, backgroundColor: c.sunken, overflow: "hidden", justifyContent: "center" }}>
      {cover && cover !== failed ? <Image source={{ uri: cover }} onError={() => setFailed(cover)} contentFit="cover" accessibilityLabel={`${title} cover`} style={{ position: "absolute", inset: 0 }} /> :
        <View style={{ paddingHorizontal: 24, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "baseline" }}>
            <Copy kind="numeric" style={{ fontSize: 68, lineHeight: 74 }} maxScale={1.2}>{meta?.[0]?.match(/\d+/)?.[0] ?? "GO"}</Copy>
            <Copy kind="caption" tone="muted">{meta?.[0]?.replace(/\d+/, "").trim()}</Copy>
          </View><BrandMark height={27} mono={c.text} />
        </View>}
    </View>
    <View style={{ paddingVertical: 16, paddingHorizontal: 20, gap: 12 }}>
      <Copy kind="title">{title}</Copy>
      {!!meta?.length && <Copy kind="small" tone="muted">{meta.join(" · ")}</Copy>}
      {!!detail && <Copy kind="small" tone="muted">{detail}</Copy>}
      {action}{extra}
    </View>
  </View></Entrance>;
}
