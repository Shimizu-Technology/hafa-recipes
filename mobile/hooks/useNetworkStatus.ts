/**
 * Hook for monitoring network connectivity status.
 * 
 * Combines device network status (NetInfo) with API reachability
 * to provide accurate online/offline detection.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import Constants from 'expo-constants';

// API base URL - same logic as api.ts
const USE_LOCAL_API = true;

function getApiBaseUrl(): string {
  if (!__DEV__ || !USE_LOCAL_API) {
    return 'https://recipe-api-x5na.onrender.com';
  }
  
  const debuggerHost = Constants.expoConfig?.hostUri || (Constants.manifest as any)?.debuggerHost;
  
  if (debuggerHost) {
    const host = debuggerHost.split(':')[0];
    return `http://${host}:8000`;
  }
  
  return 'https://recipe-api-x5na.onrender.com';
}

const API_URL = getApiBaseUrl();
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
const HEALTH_CHECK_TIMEOUT = 5000; // 5 second timeout

export interface NetworkStatus {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  isApiReachable: boolean | null;
  type: string | null;
}

/**
 * Check if the API server is reachable
 */
async function checkApiHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);
    
    const response = await fetch(`${API_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Hook that provides current network status including API reachability
 */
export function useNetworkStatus() {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isConnected: null,
    isInternetReachable: null,
    isApiReachable: null,
    type: null,
  });
  
  const healthCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  // Check API health and update state
  const performHealthCheck = useCallback(async () => {
    if (!isMountedRef.current) return;
    
    const isReachable = await checkApiHealth();
    
    if (isMountedRef.current) {
      setNetworkStatus(prev => ({
        ...prev,
        isApiReachable: isReachable,
      }));
    }
  }, []);

  // Start periodic health checks
  const startHealthChecks = useCallback(() => {
    // Clear any existing interval
    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current);
    }
    
    // Do an immediate check
    performHealthCheck();
    
    // Set up periodic checks
    healthCheckIntervalRef.current = setInterval(performHealthCheck, HEALTH_CHECK_INTERVAL);
  }, [performHealthCheck]);

  // Stop health checks
  const stopHealthChecks = useCallback(() => {
    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current);
      healthCheckIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    // Get initial network state
    NetInfo.fetch().then((state: NetInfoState) => {
      if (!isMountedRef.current) return;
      
      setNetworkStatus(prev => ({
        ...prev,
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
        type: state.type,
      }));
      
      // Start health checks if we have network
      if (state.isConnected) {
        startHealthChecks();
      }
    });

    // Subscribe to network changes
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      if (!isMountedRef.current) return;
      
      setNetworkStatus(prev => ({
        ...prev,
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
        type: state.type,
      }));
      
      if (state.isConnected) {
        // Network came back - check API immediately
        startHealthChecks();
      } else {
        // Network gone - stop checking and mark API as unreachable
        stopHealthChecks();
        setNetworkStatus(prev => ({
          ...prev,
          isApiReachable: false,
        }));
      }
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe();
      stopHealthChecks();
    };
  }, [startHealthChecks, stopHealthChecks]);

  // Combined online status - need both network AND API
  const isOnline = networkStatus.isConnected === true && 
                   networkStatus.isApiReachable === true;

  // Force a health check (useful after failed API calls)
  const recheckApiHealth = useCallback(() => {
    performHealthCheck();
  }, [performHealthCheck]);

  return {
    ...networkStatus,
    isOnline,
    recheckApiHealth,
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

/**
 * Singleton for tracking API failures across the app.
 * Call markApiFailure() when an API call fails with a network error.
 * This helps detect offline state faster than waiting for health check.
 */
let apiFailureListeners: Array<() => void> = [];

export function subscribeToApiFailure(listener: () => void): () => void {
  apiFailureListeners.push(listener);
  return () => {
    apiFailureListeners = apiFailureListeners.filter(l => l !== listener);
  };
}

export function markApiFailure() {
  apiFailureListeners.forEach(listener => listener());
}
