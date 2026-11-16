import React, { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { useRouter, useSegments, useGlobalSearchParams } from 'expo-router';

import { guestRecipeIntent } from '../lib/guestRecipeIntent';
import { getAuthProtectionRedirect } from '../lib/authProtection';

/** Apply the small set of global authentication redirects around root routes. */
export function AuthProtection({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded, sessionId } = useAuth();
  const { entry } = useGlobalSearchParams<{ entry?: string }>();
  const firstSegment = useSegments()[0];
  const router = useRouter();
  const previousSegment = useRef(firstSegment);

  useEffect(() => {
    if (!isLoaded) return;

    if (previousSegment.current === '(auth)' && firstSegment !== '(auth)' && !isSignedIn) guestRecipeIntent.clear();
    previousSegment.current = firstSegment;
    const pending = guestRecipeIntent.bind(isSignedIn ? sessionId ?? null : null);
    // A save started from a Håfa link returns to the shared view; everything else to the recipe.
    const resumeSegment = pending?.action === 'shared-save' ? 'r' : 'recipe';
    if (isSignedIn && sessionId && pending && firstSegment !== resumeSegment) {
      router.replace(`/${resumeSegment}/${pending.recipeId}`);
      return;
    }
    const redirect = getAuthProtectionRedirect(isSignedIn, firstSegment, entry);
    if (redirect) router.replace(redirect);
  }, [isSignedIn, isLoaded, firstSegment, sessionId, router, entry]);

  return <>{children}</>;
}
