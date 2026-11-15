import { recipeScope, assertRecipeScope, ownerQueryClient } from '@/lib/recipeQueryScope';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';

import { api } from '@/lib/api';
import {
  PUBLISHING_DISCLOSURE_MESSAGE,
  type PublishingDisclosureStatus,
} from '@/lib/recipePublishing';

import { usePublishingConfirmation } from '@/contexts/PublishingConfirmation';

export const DISCLOSURE_TIMEOUT_MS = 15_000;
async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Publishing request timed out.')), DISCLOSURE_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer!); }
}

const publishingDisclosureKey = ['publishingDisclosure'] as const;

export function usePublishingDisclosure() {
  const confirm = usePublishingConfirmation();
  const creationScope = recipeScope();
  const queryClient = ownerQueryClient(useQueryClient(), creationScope);
  const inFlight = useRef(false);
  const chosePrivate = useRef(false);
  const isMounted = useRef(true);
  const isScreenActive = useRef(false);
  const [isCheckingDisclosure, setIsCheckingDisclosure] = useState(false);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      confirm.cancel?.();
    };
  }, [confirm]);

  useFocusEffect(useCallback(() => {
    isScreenActive.current = true;
    return () => {
      isScreenActive.current = false;
    };
  }, []));

  const requestPublishing = useCallback(async (recipePreview?: string): Promise<boolean> => {
    if (inFlight.current) return false;
    chosePrivate.current = false;
    inFlight.current = true;
    setIsCheckingDisclosure(true);

    try {
      // Always ask the server. A cached acceptance must never outlive a newer
      // disclosure version introduced while the app is still running.
      assertRecipeScope(creationScope);
      const status = await bounded(api.getPublishingDisclosure());
      assertRecipeScope(creationScope);
      queryClient.setQueryData<PublishingDisclosureStatus>(publishingDisclosureKey, status);
      if (!isScreenActive.current) return false;
      const approved = await confirm({
        message: [status.requires_acceptance ? PUBLISHING_DISCLOSURE_MESSAGE : '', recipePreview || ''].filter(Boolean).join('\n\n'),
        label: status.requires_acceptance ? 'Agree and make public' : 'Make public',
      });
      assertRecipeScope(creationScope);
      if (!approved) { chosePrivate.current = true; return false; }
      if (!isScreenActive.current) return false;
      if (status.requires_acceptance) {
        const accepted = await bounded(api.acceptPublishingDisclosure(status.current_version));
        assertRecipeScope(creationScope);
        queryClient.setQueryData<PublishingDisclosureStatus>(publishingDisclosureKey, accepted);
      }
      return isScreenActive.current;
    } catch {
      if (isScreenActive.current) {
        Alert.alert(
          'Couldn’t check publishing preference',
          'Please check your connection and try again.',
        );
      }
      return false;
    } finally {
      inFlight.current = false;
      if (isMounted.current) setIsCheckingDisclosure(false);
    }
  }, [queryClient, confirm]);

  return { requestPublishing, isCheckingDisclosure, didChoosePrivate: () => chosePrivate.current };
}
