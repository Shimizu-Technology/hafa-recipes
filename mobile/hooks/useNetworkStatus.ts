/**
 * Hook for monitoring network connectivity status.
 * 
 * Used to determine when to sync offline changes.
 */

import { useEffect, useState, useCallback } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export interface NetworkStatus {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  type: string | null;
}

/**
 * Hook that provides current network status
 */
export function useNetworkStatus() {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isConnected: null,
    isInternetReachable: null,
    type: null,
  });

  useEffect(() => {
    // Get initial state
    NetInfo.fetch().then((state: NetInfoState) => {
      setNetworkStatus({
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
        type: state.type,
      });
    });

    // Subscribe to updates
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setNetworkStatus({
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
        type: state.type,
      });
    });

    return () => unsubscribe();
  }, []);

  // Convenience boolean - true if we can reach the internet
  const isOnline = networkStatus.isConnected === true && 
                   networkStatus.isInternetReachable !== false;

  return {
    ...networkStatus,
    isOnline,
  };
}

/**
 * Hook that triggers a callback when coming back online
 */
export function useOnlineCallback(callback: () => void) {
  const { isOnline } = useNetworkStatus();
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
    } else if (wasOffline && isOnline) {
      // We just came back online
      callback();
      setWasOffline(false);
    }
  }, [isOnline, wasOffline, callback]);
}

