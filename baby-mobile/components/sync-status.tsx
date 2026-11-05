import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { noticeTitle } from "../lib/outbox";
import { Copy, PressTarget, Row } from "./ui";
export function SyncStatus() {
  const b = useBaby();
  const notice = b.state.feedNotices?.[0];
  if (notice) return <Row title={noticeTitle(notice)} detail={notice} icon="information-circle-outline" hint="Dismisses this"
    onPress={() => void b.commit((state) => ({ ...state, feedNotices: state.feedNotices?.slice(1) }))} />;
  const failed = b.state.outbox.filter(m => (m.error || m.conflict) && !m.localOnly).length;
  // Not reaching Håfa isn't a problem to fix: her work waits here, and goes when it can.
  if (failed || (b.error && !b.unreachable))
    return <Row title={failed ? `${failed} change${failed === 1 ? " needs" : "s need"} attention` : "Sync needs attention"}
      detail={(!b.unreachable && b.error) || "Your work is safe on this phone. Review the failed changes."}
      icon="cloud-upload-outline" onPress={() => router.push("/sync")} />;
  const offline = !b.online || b.unreachable;
  if (!offline && !b.state.outbox.length) return null;
  const message = offline ? b.state.outbox.length ? "Saved on this phone · offline" : "Offline · showing what’s on this phone"
    : b.syncing ? "Saved on this phone · syncing" : "Saved on this phone";
  return <PressTarget accessibilityRole="button" accessibilityLabel={`${message}. Review sync status`}
    onPress={() => router.push("/sync")} style={{ minHeight: 44, justifyContent: "center" }}>
    <Copy kind="small" tone="muted" lines={1}>{message}</Copy>
  </PressTarget>;
}
