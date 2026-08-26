/**
 * Hook to handle recipe links, text, and images shared from other apps.
 * 
 * Routes links to URL extraction, text to the paste flow, and supported images
 * to the existing multi-image review flow.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { resolveShareIntent, stagePendingShareCapture } from '@/lib/shareCapture';

/**
 * Hook to handle incoming share intents.
 * 
 * Usage: Call this in your root layout to handle shares from anywhere in the app.
 */
export function useHandleShareIntent() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);

  useEffect(() => {
    if (isLoaded && hasShareIntent && shareIntent && !processingRef.current) {
      processingRef.current = true;
      setIsProcessing(true);

      const action = resolveShareIntent(shareIntent, isSignedIn === true);
      const navigationTimer = setTimeout(() => {
        if (action.kind === 'url') {
          router.replace({
            pathname: '/',
            params: { sharedUrl: action.url },
          });
        } else if (action.kind === 'text') {
          const captureToken = stagePendingShareCapture({ kind: 'text', text: action.text });
          router.replace({ pathname: '/paste-recipe', params: { captureToken } });
        } else if (action.kind === 'images') {
          const captureToken = stagePendingShareCapture({ kind: 'images', images: action.images });
          router.replace({ pathname: '/', params: { captureToken } });
        } else if (action.kind === 'sign-in-required') {
          Alert.alert(
            'Sign In to Import',
            'Sign in to Håfa Recipes, then share the recipe again.',
          );
          router.replace('/(tabs)/discover');
        } else {
          Alert.alert('Could Not Import Share', action.message);
        }

        resetShareIntent();
        processingRef.current = false;
        setIsProcessing(false);
      }, 300);

      return () => {
        clearTimeout(navigationTimer);
        processingRef.current = false;
      };
    }
  }, [hasShareIntent, isLoaded, isSignedIn, router, resetShareIntent, shareIntent]);

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
