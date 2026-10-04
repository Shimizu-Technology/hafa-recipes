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
import { useImportPreferences } from './useImportPreferences';

export type NativeCaptureMetadata = {
  captureKey: string;
  captureId: string;
  accountScopeId?: string | null;
  jobId?: string | null;
  recipeId?: string | null;
  submitted?: boolean;
  location?: string;
  requestedIsPublic?: boolean;
};

export function useHandleShareIntent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn } = useAuth();
  const identity = useCurrentUserIdentity(Boolean(isSignedIn));
  const ownerId = isSignedIn ? identity.data?.id ?? null : null;
  const preferences = useImportPreferences(ownerId);
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);
  const mountedRef = useRef(false);
  const currentPayloadRef = useRef(shareIntent);
  currentPayloadRef.current = shareIntent;
  const processedPayloads = useRef(new WeakSet<object>());
  const processedCaptureIds = useRef(new Set<string>());
  const processedCaptureKeys = useRef(new Set<string>());
  const [workerVersion, setWorkerVersion] = useState(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const payloadIds = useRef(new WeakMap<object, string>());
  useImportInboxProcessor();
  useShareSession();

  useEffect(() => {
    if (!isLoaded || !hasShareIntent || !shareIntent || processingRef.current ||
        (isSignedIn && (!ownerId || !preferences.ready)) || processedPayloads.current.has(shareIntent)) return;
    // Metadata and content are a single locked native snapshot. Reading the
    // queue head later can bind replayed payload A to the next capture B.
    let native: NativeCaptureMetadata | null = null;
    if (Platform.OS === 'ios') {
      const snapshot = (shareIntent as typeof shareIntent & { _hafa?: unknown })._hafa;
      try {
        native = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot as NativeCaptureMetadata | null;
      } catch { native = null; }
      if (native?.captureId && native.captureKey &&
          (processedCaptureIds.current.has(native.captureId) || processedCaptureKeys.current.has(native.captureKey))) return;
    }
    processingRef.current = true;
    setIsProcessing(true);
    let shouldDrain = false;
    void (async () => {
      try {
        // Resolve content separately from authentication. Signed-out shares are
        // durable, unassigned captures that require an explicit account choice.
        const action = resolveShareIntent(shareIntent, true);
        if (action.kind === 'sign-in-required') {
          Alert.alert('Could Not Import Share', 'Please sign in to finish importing this recipe.');
          // This is recoverable after authentication. Keep the native capture
          // and its identity unprocessed so signing in can retry its intake.
          if (currentPayloadRef.current === shareIntent) resetShareIntent(false);
          return;
        }
        if (Platform.OS === 'ios' && (!native?.captureKey || !native.captureId)) {
          throw new Error('Could not confirm this shared recipe. It is still saved; please reopen Håfa to try again.');
        }
        if (action.kind === 'unsupported') {
          // An unsupported capture cannot enter the recipe inbox. Reject only
          // this exact native entry so it cannot block later supported shares.
          // Failed acknowledgment leaves it unprocessed and safe to retry.
          if (native && !(await ShareBridge.acknowledgeCapture(native.captureKey))) {
            throw new Error(`${action.message} This share could not be dismissed yet. It is still saved; reopen Håfa to try again.`);
          }
          processedPayloads.current.add(shareIntent);
          if (native) {
            processedCaptureIds.current.add(native.captureId);
            processedCaptureKeys.current.add(native.captureKey);
          }
          shouldDrain = Platform.OS === 'ios';
          if (currentPayloadRef.current === shareIntent) resetShareIntent(Platform.OS !== 'ios');
          if (mountedRef.current) Alert.alert('Could Not Import Share', action.message);
          return;
        }
        let id = native?.captureId || payloadIds.current.get(shareIntent);
        if (!id) {
          id = Crypto.randomUUID();
          payloadIds.current.set(shareIntent, id);
        }
        const captureOwner = native ? (native.accountScopeId ? await getShareScopeOwner(native.accountScopeId) : null) : ownerId;
        const submitted = Boolean(native?.submitted && (native.jobId || native.recipeId));
        // Missing metadata belongs to legacy private captures. New native
        // captures explicitly snapshot public/private at share time.
        const capturedPreferences = { isPublic: native ? native.requestedIsPublic === true : preferences.isPublic,
          location: native?.location || preferences.location };
        await importInbox.add({
          id, ownerId: captureOwner, capture: action as ImportCapture,
          accountScopeId: native?.accountScopeId ?? undefined,
          createdAt: Date.now(),
          state: submitted ? 'accepted' : captureOwner && action.kind === 'url' ? 'ready' : 'waiting',
          jobId: native?.jobId ?? undefined, recipeId: native?.recipeId ?? undefined,
          preferences: capturedPreferences,
          ...(action.kind === 'url' ? { request: {
            url: action.url, location: capturedPreferences.location, notes: '',
            is_public: capturedPreferences.isPublic,
          } } : {}),
        });
        if (submitted) void queryClient.invalidateQueries({ queryKey: extractionJobKeys.all });
        if (native && !(await ShareBridge.acknowledgeCapture(native.captureKey))) {
          throw new Error('Your import is saved. We could not confirm the share handoff; reopen Håfa to reconnect.');
        }
        // Clear only the JS payload. Native data was acknowledged by exact ID.
        processedPayloads.current.add(shareIntent);
        if (native) {
          processedCaptureIds.current.add(native.captureId);
          processedCaptureKeys.current.add(native.captureKey);
        }
        shouldDrain = Platform.OS === 'ios';
        // A new onChange can arrive while A is persisting/acknowledging. Do
        // not clear B's payload or navigate for A after B has taken its place.
        if (currentPayloadRef.current === shareIntent) {
          resetShareIntent(Platform.OS !== 'ios');
          if (mountedRef.current) router.replace({ pathname: '/', params: { inboxCaptureId: id } });
        }
      } catch (error) {
        if (mountedRef.current) Alert.alert('Shared Recipe Saved for Later', error instanceof Error
          ? error.message : 'Please reopen Håfa to finish importing.');
      } finally {
        processingRef.current = false;
        if (mountedRef.current) {
          setIsProcessing(false);
          if (shouldDrain || currentPayloadRef.current !== shareIntent) setWorkerVersion((version) => version + 1);
          if (shouldDrain) setTimeout(() => { void ShareIntentModule?.getShareIntent(''); }, 0);
        }
      }
    })();
  }, [hasShareIntent, isLoaded, isSignedIn, ownerId, router, resetShareIntent, shareIntent, queryClient,
    workerVersion, preferences.ready, preferences.isPublic, preferences.location]);
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
