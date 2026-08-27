import React, { useEffect } from 'react';
import { useAuth } from '@clerk/expo';
import { useRouter, useSegments } from 'expo-router';

import { getAuthProtectionRedirect } from '../lib/authProtection';

/** Apply the small set of global authentication redirects around root routes. */
export function AuthProtection({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  const firstSegment = useSegments()[0];
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;

    const redirect = getAuthProtectionRedirect(isSignedIn, firstSegment);
    if (redirect) router.replace(redirect);
  }, [isSignedIn, isLoaded, firstSegment, router]);

  return <>{children}</>;
}
