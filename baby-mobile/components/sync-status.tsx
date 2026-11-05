import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { noticeTitle, waitingToSend } from "../lib/outbox";
import { Copy, Icon, PressTarget, Row, useColors } from "./ui";
export function SyncStatus() {
  const b = useBaby(), c = useColors();
  const notice = b.state.feedNotices?.[0];
  if (notice) return <Row title={noticeTitle(notice)} detail={notice} icon="information-circle-outline" hint="Dismisses this" trailing={<Icon name="close" size={17} color={c.muted} />}
    onPress={() => void b.commit((state) => ({ ...state, feedNotices: state.feedNotices?.slice(1) }))} />;
  const waiting = waitingToSend(b.state), failed = waiting.filter(m => (m.error || m.conflict) && !m.localOnly).length;
  // Not reaching Håfa isn't a problem to fix: her work waits here, and goes when it can.
  if (failed || (b.error && !b.unreachable))
    return <Row title={failed ? `${failed} change${failed === 1 ? " needs" : "s need"} attention` : "Sync needs attention"}
      detail={(!b.unreachable && b.error) || "Your work is safe on this phone. Review the failed changes."}
      icon="cloud-upload-outline" onPress={() => router.push("/sync")} />;
  const offline = !b.online || b.unreachable;
  if (!offline && !waiting.length) return null;
  const message = offline ? waiting.length ? "Saved on this phone · offline" : "Offline · showing what’s on this phone"
    : b.syncing ? "Saved on this phone · syncing" : "Saved on this phone";
  return <PressTarget accessibilityRole="button" accessibilityLabel={`${message}. Review sync status`}
    onPress={() => router.push("/sync")} style={{ minHeight: 44, justifyContent: "center" }}>
    <Copy kind="small" tone="muted" lines={1}>{message}</Copy>
  </PressTarget>;
}
