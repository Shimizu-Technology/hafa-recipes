import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import {
  PUBLISHING_DISCLOSURE_MESSAGE,
  type PublishingDisclosureStatus,
} from '@/lib/recipePublishing';

const publishingDisclosureKey = ['publishingDisclosure'] as const;

export function usePublishingDisclosure() {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [isCheckingDisclosure, setIsCheckingDisclosure] = useState(false);

  const requestPublishing = useCallback(async (recipePreview?: string): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setIsCheckingDisclosure(true);

    try {
      const status = await queryClient.fetchQuery({
        queryKey: publishingDisclosureKey,
        queryFn: () => api.getPublishingDisclosure(),
        staleTime: Infinity,
      });
      if (!status.requires_acceptance) return true;

      return await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Before you publish recipes',
          recipePreview
            ? `${PUBLISHING_DISCLOSURE_MESSAGE}\n\nFor this recipe: ${recipePreview}`
            : PUBLISHING_DISCLOSURE_MESSAGE,
          [
            { text: 'Keep private', style: 'cancel', onPress: () => resolve(false) },
            {
              text: 'Agree and publish',
              onPress: async () => {
                try {
                  const accepted = await api.acceptPublishingDisclosure(status.current_version);
                  queryClient.setQueryData<PublishingDisclosureStatus>(
                    publishingDisclosureKey,
                    accepted,
                  );
                  resolve(true);
                } catch {
                  Alert.alert(
                    'Couldn’t update publishing preference',
                    'Please check your connection and try again. Your recipe remains private.',
                  );
                  resolve(false);
                }
              },
            },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
    } catch {
      Alert.alert(
        'Couldn’t check publishing preference',
        'Please check your connection and try again. Your recipe remains private.',
      );
      return false;
    } finally {
      inFlight.current = false;
      setIsCheckingDisclosure(false);
    }
  }, [queryClient]);

  return { requestPublishing, isCheckingDisclosure };
}
