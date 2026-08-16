/**
 * Global offline indicator banner.
 * 
 * Shows when the app cannot reach the API server.
 * Automatically appears/disappears based on connection status.
 * 
 * Includes a brief delay on initial load to avoid flashing the banner
 * while network status is still being determined.
 */

import React, { useState } from 'react';
import { Text, StyleSheet, Animated, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { spacing, fontSize, fontWeight } from '@/constants/Colors';
import { useEffect, useRef } from 'react';

// Delay before showing offline banner on app start (ms)
// This prevents flashing while network status initializes
const INITIAL_DELAY_MS = 3000;

// Auto-hide the banner after this duration (user can tap to retry)
const AUTO_HIDE_DELAY_MS = 10000;

export function OfflineBanner() {
  const { isOnline, isApiReachable, isConnected, recheckApiHealth } = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const [hasInitialized, setHasInitialized] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [userDismissed, setUserDismissed] = useState(false);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // After initial delay, we're ready to show the banner if needed
  useEffect(() => {
    const timer = setTimeout(() => {
      setHasInitialized(true);
    }, INITIAL_DELAY_MS);
    
    return () => clearTimeout(timer);
  }, []);

  // Also consider initialized once we get a positive status
  // (if we detect online status quickly, no need to wait for delay)
  useEffect(() => {
    if (isOnline === true || isApiReachable === true) {
      setHasInitialized(true);
    }
  }, [isOnline, isApiReachable]);

  // Reset user dismissal when we come back online (so it can show again next time)
  useEffect(() => {
    if (isOnline) {
      setUserDismissed(false);
    }
  }, [isOnline]);

  // Only show banner if:
  // 1. We've finished initializing (either via delay or positive detection)
  // 2. AND we've positively determined we're offline (not just null/unknown)
  // 3. AND user hasn't dismissed it
  const isDefinitelyOffline = isConnected === false || isApiReachable === false;
  const showBanner = hasInitialized && isDefinitelyOffline && !userDismissed;

  // Auto-hide after delay
  useEffect(() => {
    if (showBanner) {
      // Clear any existing timer
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
      }
      
      // Set auto-hide timer
      autoHideTimerRef.current = setTimeout(() => {
        setUserDismissed(true);
      }, AUTO_HIDE_DELAY_MS);
    }
    
    return () => {
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
      }
    };
  }, [showBanner]);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: showBanner ? 0 : -100,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [showBanner, slideAnim]);

  const handleRetry = async () => {
    setIsRetrying(true);
    await recheckApiHealth();
    // Small delay to show the spinner
    setTimeout(() => {
      setIsRetrying(false);
    }, 1000);
  };

  // Don't render at all when online (after animation completes)
  if (!showBanner) {
    return null;
  }

  return (
    <TouchableOpacity 
      activeOpacity={0.8}
      onPress={handleRetry}
    >
      <Animated.View 
        style={[
          styles.banner,
          { 
            paddingTop: insets.top + spacing.xs,
            transform: [{ translateY: slideAnim }],
          }
        ]}
      >
        {isRetrying ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Ionicons name="cloud-offline-outline" size={16} color="#FFFFFF" />
        )}
        <Text style={styles.bannerText}>
          {isRetrying ? 'Checking connection...' : 'You\'re offline • Tap to retry'}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#F5A623', // Warning yellow/orange
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    zIndex: 1000,
  },
  bannerText: {
    color: '#FFFFFF',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
});

