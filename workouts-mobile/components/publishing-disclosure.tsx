import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Copy, Row, Sheet, Stack, useColors } from "@/components/ui";
import { useTraining } from "@/lib/context";
import {
  PUBLISHING_DISCLOSURE_POINTS,
  PUBLISHING_DISCLOSURE_TITLE,
  withPublishingDisclosure,
} from "@/lib/discover";

/**
 * The shared Håfa publishing disclosure as a bottom sheet. `run(write)` performs
 * a publishing write; when the server answers 409 it shows this sheet, records
 * acceptance on the shared account endpoint and retries once.
 */
export function usePublishingDisclosure() {
  const { api } = useTraining();
  const c = useColors();
  const [open, setOpen] = useState(false);
  const resolver = useRef<((agreed: boolean) => void) | null>(null);
  const settle = useCallback((agreed: boolean) => {
    resolver.current?.(agreed);
    resolver.current = null;
    setOpen(false);
  }, []);
  useEffect(() => () => resolver.current?.(false), []);
  const ask = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOpen(true);
      }),
    []
  );
  const run = useCallback(
    <T,>(attempt: () => Promise<T>) =>
      withPublishingDisclosure(attempt, {
        status: api.publishingDisclosure,
        accept: api.acceptPublishingDisclosure,
        ask,
      }),
    [api, ask]
  );
  const sheet = (
    <Sheet visible={open} onClose={() => settle(false)} title={PUBLISHING_DISCLOSURE_TITLE}>
      <Stack gap={12}>
        {PUBLISHING_DISCLOSURE_POINTS.map((point) => (
          <Row key={point} gap={12} align="flex-start">
            <View style={{ paddingTop: 2 }}>
              <Ionicons name="checkmark-circle-outline" size={20} color={c.onActionSoft} />
            </View>
            <Copy kind="small" style={{ flex: 1 }}>
              {point}
            </Copy>
          </Row>
        ))}
        <Button title="Agree and share" icon="globe-outline" onPress={() => settle(true)} />
        <Button title="Keep it private" variant="ghost" onPress={() => settle(false)} />
      </Stack>
    </Sheet>
  );
  /** Closes an open sheet as "keep private" (e.g. the screen switched to another record). */
  const dismiss = useCallback(() => {
    if (resolver.current) settle(false);
  }, [settle]);
  return { run, sheet, dismiss };
}
