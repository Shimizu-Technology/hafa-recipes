import React, { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { useRouter, useSegments } from 'expo-router';

import { guestRecipeIntent } from '../lib/guestRecipeIntent';
import { getAuthProtectionRedirect } from '../lib/authProtection';

/** Apply the small set of global authentication redirects around root routes. */
export function AuthProtection({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded, sessionId } = useAuth();
  const firstSegment = useSegments()[0];
  const router = useRouter();
  const previousSegment = useRef(firstSegment);

  useEffect(() => {
    if (!isLoaded) return;

    if (previousSegment.current === '(auth)' && firstSegment !== '(auth)' && !isSignedIn) guestRecipeIntent.clear();
    previousSegment.current = firstSegment;
    const pending = guestRecipeIntent.bind(isSignedIn ? sessionId ?? null : null);
    if (isSignedIn && sessionId && pending && firstSegment !== 'recipe') {
      router.replace(`/recipe/${pending.recipeId}`);
      return;
    }
    const redirect = getAuthProtectionRedirect(isSignedIn, firstSegment);
    if (redirect) router.replace(redirect);
  }, [isSignedIn, isLoaded, firstSegment, sessionId, router]);

  return <>{children}</>;
}
