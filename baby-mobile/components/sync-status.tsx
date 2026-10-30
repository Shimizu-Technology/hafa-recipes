import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { Notice, Row } from "./ui";
export function SyncStatus() {
  const b = useBaby();
  const failed = b.state.outbox.filter(m => (m.error || m.conflict) && !m.localOnly).length;
  if (!b.online || b.state.outbox.length)
    return (
      <Row
        title={
          failed
            ? `${failed} change${failed === 1 ? "" : "s"} need${failed === 1 ? "s" : ""} attention`
            : !b.online
            ? "You’re offline"
            : b.syncing
              ? "Syncing your changes…"
              : `${b.state.outbox.length} saved change${b.state.outbox.length === 1 ? "" : "s"} on this device`
        }
        detail={b.error || (failed ? "Your work is safe on this phone. Review the failed changes." : "Your work is kept privately. Review or retry here.")}
        icon="cloud-upload-outline"
        onPress={() => router.push("/sync")}
      />
    );
  return b.error ? <Notice error>{b.error}</Notice> : null;
}
