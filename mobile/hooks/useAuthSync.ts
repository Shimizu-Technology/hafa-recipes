/**
 * Hook to sync Clerk authentication with the API client.
 * 
 * This ensures the API client always has the current auth token.
 */

import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-expo';
import { api } from '@/lib/api';

export function useAuthSync() {
  const { getToken, isSignedIn, isLoaded } = useAuth();

  useEffect(() => {
    const syncToken = async () => {
      if (!isLoaded) return;

      if (isSignedIn) {
        // Get the current session token
        const token = await getToken();
        api.setAuthToken(token);
      } else {
        // Clear the token when signed out
        api.setAuthToken(null);
      }
    };

    syncToken();
  }, [isSignedIn, isLoaded, getToken]);

  return { isSignedIn, isLoaded };
}

