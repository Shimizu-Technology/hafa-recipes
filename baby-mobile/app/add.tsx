import { router } from "expo-router";
import { Grouped, Row, Screen } from "@/components/ui";
import { keepItems } from "../lib/trackers";
import { kindIcon } from "@/components/record-row";

export default function Add() {
  return (
    <Screen title="What’s on your mind?" subtitle="Save it now. Find it when you need it." close>
      <Grouped>{keepItems.map((item) => (
        <Row
          key={item.kind}
          title={item.title}
          detail={item.detail}
          icon={kindIcon[item.kind]}
          onPress={() => router.replace({ pathname: "/edit", params: { kind: item.kind } })}
        />
      ))}</Grouped>
    </Screen>
  );
}
