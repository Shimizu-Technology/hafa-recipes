import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { Copy, PressTarget, Row } from "./ui";
export function SyncStatus() {
  const b = useBaby();
  const failed = b.state.outbox.filter(m => (m.error || m.conflict) && !("localOnly" in m && m.localOnly)).length;
  if (failed || b.error)
    return <Row title={failed ? `${failed} change${failed === 1 ? " needs" : "s need"} attention` : "Sync needs attention"}
      detail={b.error || "Your work is safe on this phone. Review the failed changes."}
      icon="cloud-upload-outline" onPress={() => router.push("/sync")} />;
  if (b.online && !b.state.outbox.length) return null;
  const message = !b.online ? "Saved on this phone · offline"
    : b.syncing ? "Saved on this phone · syncing" : "Saved on this phone";
  return <PressTarget accessibilityRole="button" accessibilityLabel={`${message}. Review sync status`}
    onPress={() => router.push("/sync")} style={{ minHeight: 44, justifyContent: "center" }}>
    <Copy kind="small" tone="muted" lines={1}>{message}</Copy>
  </PressTarget>;
}
