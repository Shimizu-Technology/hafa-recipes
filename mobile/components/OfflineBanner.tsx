/** Persistent connection status. Unknown initial connectivity gets a brief grace period. */
import React, { useEffect, useRef, useState } from 'react';
import { Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { brand, spacing, fontSize, fontWeight } from '@/constants/Colors';

const INITIAL_DELAY_MS = 3000;

export function OfflineBanner() {
  const { isOnline, isApiReachable, isConnected, recheckApiHealth } = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const [hasInitialized, setHasInitialized] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const mounted = useRef(false);
  const retrying = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => setHasInitialized(true), INITIAL_DELAY_MS);
    return () => { mounted.current = false; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (isOnline || isApiReachable === true) setHasInitialized(true);
    setRetryFailed(false);
  }, [isOnline, isApiReachable, isConnected]);
  const showBanner = hasInitialized && (isConnected === false || isApiReachable === false);
  const handleRetry = async () => {
    if (retrying.current) return;
    retrying.current = true;
    setIsRetrying(true);
    setRetryFailed(false);
    try {
      const reachable = await recheckApiHealth();
      if (mounted.current) setRetryFailed(reachable === false);
    } catch {
      if (mounted.current) setRetryFailed(true);
    } finally {
      retrying.current = false;
      if (mounted.current) setIsRetrying(false);
    }
  };
  if (!showBanner) return null;
  const label = isRetrying ? 'Checking connection…' : retryFailed ? 'Still unavailable • Tap to retry'
    : isConnected === false ? 'You’re offline • Tap to retry' : 'Can’t reach Håfa • Tap to retry';
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => { void handleRetry(); }}
      disabled={isRetrying}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Checks the connection to Håfa."
      accessibilityState={{ disabled: isRetrying, busy: isRetrying }}
      accessibilityLiveRegion="polite"
      style={[styles.banner, { paddingTop: insets.top + spacing.xs }]}
    >
      {isRetrying ? <ActivityIndicator size="small" color={brand.ink} />
        : <Ionicons name="cloud-offline-outline" size={16} color={brand.ink} />}
      <Text style={styles.bannerText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Reserve space instead of permanently covering navigation controls. No motion.
  banner: {
    backgroundColor: brand.banana,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  bannerText: {
    color: brand.ink,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    flexShrink: 1,
  },
});
