import { useAuth, useUser } from '@clerk/expo';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import {
  subscribeToGroceryWidgetRefresh,
  synchronizeGroceryWidget,
} from '@/lib/groceryWidget';
import { isRetryableGroceryError } from '@/lib/grocerySync';
import { captureError } from '@/lib/sentry';

/** Keeps the native widget capability and server snapshot current while signed in. */
export function GroceryWidgetCoordinator() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const identityEpochRef = useRef(0);
  const currentUserId = isLoaded && isSignedIn ? user?.id ?? null : null;

  const synchronize = useCallback(() => {
    if (!currentUserId) return;
    const epoch = ++identityEpochRef.current;
    void synchronizeGroceryWidget(
      currentUserId,
      () => identityEpochRef.current === epoch,
    ).catch((error) => {
      if (identityEpochRef.current !== epoch) return;
      // Offline/temporary server failures are expected here. The widget keeps
      // its last confirmed snapshot and retries on the next foreground event.
      if (isRetryableGroceryError(error)) return;
      captureError(error instanceof Error ? error : new Error(String(error)), {
        tags: { operation: 'synchronizeGroceryWidget' },
      });
    });
  }, [currentUserId]);

  useEffect(() => {
    if (currentUserId) synchronize();
    return () => {
      identityEpochRef.current += 1;
    };
  }, [currentUserId, synchronize]);

  useEffect(() => subscribeToGroceryWidgetRefresh(synchronize), [synchronize]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') synchronize();
    });
    return () => subscription.remove();
  }, [synchronize]);

  return null;
}
