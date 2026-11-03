import { useEffect } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useLook } from "@/lib/look-context";
import { linkLook } from "@/constants/looks";
import { Copy, Screen } from "@/components/ui";
export default function DesignPreview() {
  const { look } = useLocalSearchParams<{ look?: string }>();
  const preview = useLook();
  useEffect(() => {
    const id = linkLook(look, preview.enabled);
    if (id) preview.setLook(id);
    router.replace("/(tabs)/train");
    // A route visit applies once; provider updates must not reapply an old URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look]);
  return <Screen title="Design preview"><Copy>Opening your preview…</Copy></Screen>;
}
