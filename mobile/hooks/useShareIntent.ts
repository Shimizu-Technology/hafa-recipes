/** Durable intake for recipe links, text, and images shared from another app. */
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { ShareIntentModule, useShareIntentContext } from 'expo-share-intent';
import * as Crypto from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import * as ShareBridge from '@/modules/hafa-share-bridge/src';
import { resolveShareIntent } from '@/lib/shareCapture';
import { importInbox, getShareScopeOwner, type ImportCapture } from '@/lib/importInbox';
import { extractionJobKeys, useCurrentUserIdentity } from '@/hooks/useRecipes';
import { useImportInboxProcessor } from './useImportInbox';
import { useShareSession } from './useShareSession';

export type NativeCaptureMetadata = {
  captureKey: string;
  captureId: string;
  accountScopeId?: string | null;
  jobId?: string | null;
  recipeId?: string | null;
  submitted?: boolean;
  location?: string;
  isPublic?: boolean;
};

export function useHandleShareIntent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn } = useAuth();
  const identity = useCurrentUserIdentity(Boolean(isSignedIn));
  const ownerId = isSignedIn ? identity.data?.id ?? null : null;
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);
  const payloadIds = useRef(new WeakMap<object, string>());
  useImportInboxProcessor();
  useShareSession();

  useEffect(() => {
    if (!isLoaded || !hasShareIntent || !shareIntent || processingRef.current ||
        (isSignedIn && !ownerId)) return;
    processingRef.current = true;
    setIsProcessing(true);
    let mounted = true;
    let shouldDrain = false;
    void (async () => {
      try {
        // Resolve content separately from authentication. Signed-out shares are
        // durable, unassigned captures that require an explicit account choice.
        const action = resolveShareIntent(shareIntent, true);
        if (action.kind === 'unsupported' || action.kind === 'sign-in-required') {
          Alert.alert('Could Not Import Share', action.kind === 'unsupported'
            ? action.message : 'Please sign in to finish importing this recipe.');
          resetShareIntent(false);
          return;
        }
        let native: NativeCaptureMetadata | null = null;
        if (Platform.OS === 'ios') {
          const raw = await ShareBridge.getCurrentCaptureMetadata();
          native = raw ? JSON.parse(raw) as NativeCaptureMetadata : null;
          if (!native?.captureKey || !native.captureId) {
            throw new Error('Could not confirm this shared recipe. It is still saved; please reopen Håfa to try again.');
          }
        }
        let id = native?.captureId || payloadIds.current.get(shareIntent);
        if (!id) {
          id = Crypto.randomUUID();
          payloadIds.current.set(shareIntent, id);
        }
        const captureOwner = native ? (native.accountScopeId ? await getShareScopeOwner(native.accountScopeId) : null) : ownerId;
        const submitted = Boolean(native?.submitted && (native.jobId || native.recipeId));
        await importInbox.add({
          id, ownerId: captureOwner, capture: action as ImportCapture,
          accountScopeId: native?.accountScopeId ?? undefined,
          createdAt: Date.now(),
          state: submitted ? 'accepted' : captureOwner && action.kind === 'url' ? 'ready' : 'waiting',
          jobId: native?.jobId ?? undefined, recipeId: native?.recipeId ?? undefined,
          ...(action.kind === 'url' ? { request: {
            url: action.url, location: native?.location || 'Guam', notes: '',
            is_public: native?.isPublic ?? false,
          } } : {}),
        });
        if (submitted) void queryClient.invalidateQueries({ queryKey: extractionJobKeys.all });
        if (native && !(await ShareBridge.acknowledgeCapture(native.captureKey))) {
          throw new Error('Your import is saved. We could not confirm the share handoff; reopen Håfa to reconnect.');
        }
        // Clear only the JS payload. Native data was acknowledged by exact ID.
        resetShareIntent(Platform.OS !== 'ios');
        if (!mounted) return;
        router.replace({ pathname: '/', params: { inboxCaptureId: id } });
        shouldDrain = Platform.OS === 'ios';
      } catch (error) {
        if (mounted) Alert.alert('Shared Recipe Saved for Later', error instanceof Error
          ? error.message : 'Please reopen Håfa to finish importing.');
      } finally {
        processingRef.current = false;
        if (mounted) setIsProcessing(false);
        if (shouldDrain) setTimeout(() => { void ShareIntentModule?.getShareIntent(''); }, 0);
      }
    })();
    return () => { mounted = false; };
  }, [hasShareIntent, isLoaded, isSignedIn, ownerId, router, resetShareIntent, shareIntent, queryClient]);
  return { hasShareIntent, isProcessing };
}

/**
 * Check if a URL is a supported recipe source
 */
export function isSupportedRecipeUrl(url: string): boolean {
  const supported = [
    'tiktok.com',
    'youtube.com',
    'youtu.be',
    'instagram.com',
    // Website URLs are also supported
  ];
  
  const lowerUrl = url.toLowerCase();
  
  // Video platforms
  if (supported.some(domain => lowerUrl.includes(domain))) {
    return true;
  }
  
  // Any https URL can be a recipe website
  if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
    return true;
  }
  
  return false;
}
