import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";
import { router } from "expo-router";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { healthOwnerScope } from "@/lib/health-client";
import {
  createReminders,
  defaultReminderSettings,
  type RemindersController,
  type LocalNotifications,
} from "@/lib/reminders";
import { nativeNotifications, notificationOwner, observeNotificationResponses } from "@/lib/notifications-adapter";
const Context = createContext<RemindersController | null>(null);
const empty = {
  settings: defaultReminderSettings(),
  timer: null,
  permission: "unknown" as const,
  ready: false,
  error: "",
};
export function RemindersProvider({ children }: PropsWithChildren) {
  const { owner, enrollment, storage } = useTraining();
  const offline = useOfflineTraining();
  const scope = enrollment?.enrolled && enrollment.generation ? healthOwnerScope(owner, enrollment.generation) : null;
  const current = useRef<string | null>(scope);
  current.current = scope;
  notificationOwner(scope);
  const active = useRef(offline.state.active);
  active.current = offline.state.active;
  const [adapter, setAdapter] = useState<LocalNotifications | null>(null);
  useEffect(() => {
    let mounted = true;
    void nativeNotifications().then((value) => {
      if (mounted) setAdapter(value);
    });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    current.current = scope;
    notificationOwner(scope);
    return () => {
      if (current.current === scope) current.current = null;
      notificationOwner(null);
    };
  }, [scope]);
  const controller = useMemo(
    () =>
      adapter && scope
        ? createReminders({
            storage,
            adapter,
            owner_scope: scope,
            currentOwnerScope: () => current.current,
          })
        : null,
    [adapter, scope, storage]
  );
  useEffect(() => {
    if (!controller) return;
    void controller.load().catch(controller.report);
    const sub = AppState.addEventListener("change", (value) => {
      if (value === "active") void controller.resume().catch(controller.report);
    });
    return () => {
      sub.remove();
      void controller.cleanupOwned().catch(() => undefined);
    };
  }, [controller]);
  useEffect(() => {
    if (controller && offline.ready)
      void controller
        .timer(
          offline.state.active && !offline.state.active.paused && offline.state.active.rest_until
            ? { session_id: offline.state.active.id, until: offline.state.active.rest_until }
            : null
        )
        .catch(controller.report);
  }, [
    controller,
    offline.ready,
    offline.state.active?.id,
    offline.state.active?.rest_until,
    offline.state.active?.paused,
  ]);
  useEffect(() => {
    let mounted = true;
    let clean: (() => void) | undefined;
    if (scope)
      void observeNotificationResponses(scope, (intent) => {
        if (!mounted || current.current !== scope) return;
        if (intent.kind === "rest" && active.current?.id === intent.session_id) router.push("/training");
        else if (intent.kind === "routine") router.push("/(tabs)");
      }).then((value) => {
        if (mounted) clean = value;
        else value();
      });
    return () => {
      mounted = false;
      clean?.();
    };
  }, [scope]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function useReminders() {
  const controller = useContext(Context);
  const state = useSyncExternalStore(
    controller?.subscribe ?? (() => () => {}),
    controller?.snapshot ?? (() => empty),
    () => empty
  );
  return { controller, state };
}
