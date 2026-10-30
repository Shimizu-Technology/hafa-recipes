import { reminderRoutes } from "@/lib/notification-route";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { router, useNavigationContainerRef, usePathname, useSegments } from "expo-router";
import { useBaby } from "@/lib/context";
import { useToast } from "./ui";
import {
  createReminderTapController,
  notificationResponseKey,
  reminderNavigationReady,
} from "@/lib/notification-route";

/** Mounted inside the signed-in provider, after AccountGate restores private identity and bootstrap. */
export function NotificationResponseHandler() {
  const baby = useBaby(),
    navigation = useNavigationContainerRef(),
    pathname = usePathname(),
    segments = useSegments(),
    lease = baby.api.lease(),
    toast = useToast();
  const [navigationReady, setNavigationReady] = useState(() => navigation.isReady());
  useEffect(() => {
    const update = () => setNavigationReady(navigation.isReady());
    const state = navigation.addListener("state", update),
      ready = navigation.addListener("ready", update);
    update();
    return () => {
      state();
      ready();
    };
  }, [navigation]);
  const routeReady = reminderNavigationReady(navigationReady, pathname, segments);
  const live = useRef({ baby, navigationReady: routeReady, pathname, toast });
  useLayoutEffect(() => { live.current = { baby, navigationReady: routeReady, pathname, toast }; });
  const controller = useRef<ReturnType<typeof createReminderTapController> | null>(null);
  useEffect(() => {
    if (Platform.OS === "web") return;
    let mounted = true;
    const handler = createReminderTapController(
      {
        session: () => {
          const { baby: b, navigationReady } = live.current,
            bootstrap = b.state.bootstrap;
          return bootstrap && typeof bootstrap.active === "boolean"
            ? {
                owner: b.owner,
                generation: bootstrap.generation,
                active: bootstrap.active,
                ready: b.ready,
                navigationReady,
                lease: b.api.lease(),
              }
            : null;
        },
        current: () => mounted && live.current.baby.current(),
        destination: () => live.current.pathname,
        cached: (id) => live.current.baby.records.find((record) => record.id === id),
        deleted: (id) =>
          live.current.baby.state.outbox.some((change) => change.type === "delete" && change.record.id === id),
        fetch: (id) => live.current.baby.api.record(id),
        open: (id) => {
          if (live.current.pathname !== "/record/" + id) router.push({ pathname: "/record/[id]", params: { id } });
        },
        fallback: () => {
          if (live.current.pathname !== "/routines") router.push(reminderRoutes.routines);
          live.current.toast("Could not open that reminder. Your saved routines are here.");
        },
        retry: () => live.current.toast("Open Routines to find your reminder, or try this notification again."),
        acknowledge: (key) => {
          try {
            if (notificationResponseKey(Notifications.getLastNotificationResponse()) === key)
              Notifications.clearLastNotificationResponse();
          } catch {
            /* Native receipt stays retryable if clearing is unavailable. */
          }
        },
      },
      Notifications.DEFAULT_ACTION_IDENTIFIER
    );
    controller.current = handler;
    // Subscribe first, then inspect cold-start state so a concurrent hot response is not lost.
    const listener = Notifications.addNotificationResponseReceivedListener((response) => {
      void handler.offer(response);
    });
    const inspect = () => {
      try {
        const response = Notifications.getLastNotificationResponse();
        if (response) void handler.offer(response);
      } catch {
        /* Foreground retry can recover a temporarily unavailable native bridge. */
      }
    };
    inspect();
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") inspect();
    });
    return () => {
      mounted = false;
      listener.remove();
      app.remove();
      handler.dispose();
      controller.current = null;
    };
  }, []);
  useEffect(() => {
    void controller.current?.resume();
  }, [
    baby.ready,
    baby.owner,
    baby.state.bootstrap?.active,
    baby.state.bootstrap?.generation,
    routeReady,
    pathname,
    segments.join("/"),
    lease,
  ]);
  return null;
}
