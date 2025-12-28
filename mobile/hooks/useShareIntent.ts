/**
 * Hook to handle shared URLs from other apps via iOS Share Extension.
 * 
 * When a user shares a URL (e.g., from TikTok, Safari, Instagram) to Håfa Recipes,
 * this hook captures the URL and navigates to the extract screen with it pre-filled.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';

/**
 * Extracts a URL from the shared content
 */
function extractUrlFromIntent(shareIntent: any): string | null {
  if (!shareIntent) return null;

  // Check for webUrl (direct URL share from Safari, etc.)
  if (shareIntent.webUrl) {
    return shareIntent.webUrl;
  }

  // Check for text that might contain a URL (from TikTok, Instagram, etc.)
  if (shareIntent.text) {
    // Try to find a URL in the text
    const urlMatch = shareIntent.text.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      return urlMatch[0];
    }
  }

  // Check for meta.url (some apps provide it here)
  if (shareIntent.meta?.url) {
    return shareIntent.meta.url;
  }

  return null;
}

/**
 * Hook to handle incoming share intents.
 * 
 * Usage: Call this in your root layout to handle shares from anywhere in the app.
 */
export function useHandleShareIntent() {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (hasShareIntent && shareIntent && !isProcessing) {
      setIsProcessing(true);

      const sharedUrl = extractUrlFromIntent(shareIntent);
      
      if (sharedUrl) {
        console.log('📥 Share Intent received:', sharedUrl);
        
        // Navigate to the extract tab (index) with the URL
        // We use replace to avoid having a weird back stack
        // Small delay ensures the navigation stack is ready
        setTimeout(() => {
          router.replace({
            pathname: '/',
            params: { sharedUrl: sharedUrl }
          });
          
          resetShareIntent();
          setIsProcessing(false);
        }, 300);
      } else {
        console.log('⚠️ Share Intent received but no URL found:', shareIntent);
        resetShareIntent();
        setIsProcessing(false);
      }
    }
  }, [hasShareIntent, shareIntent, isProcessing, router, resetShareIntent]);

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
