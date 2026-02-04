/**
 * Floating Action Button (FAB) for the Cooking Assistant.
 * 
 * Appears on main tabs to provide quick access to the general cooking chat.
 * Positioned in bottom-right corner, above the tab bar.
 */

import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View as RNView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { 
  FadeIn,
  useAnimatedStyle,
  withSpring,
  useSharedValue,
} from 'react-native-reanimated';

import { Text, useColors } from '@/components/Themed';
import RecipeChatModal from '@/components/RecipeChatModal';
import { haptics } from '@/utils/haptics';
import { spacing, radius, fontSize, fontWeight } from '@/constants/Colors';

const TAB_BAR_HEIGHT = 85; // Approximate height of tab bar + safe area

export default function FloatingChatButton() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [showChat, setShowChat] = useState(false);
  
  // Scale animation for press feedback
  const scale = useSharedValue(1);
  
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Determine which screens should show the FAB
  // Show on: main tabs (discover, history, grocery, meal-plan, settings)
  // Hide on: recipe detail, cook mode, add recipe, edit recipe, etc.
  const shouldShow = React.useMemo(() => {
    // Main tab routes where FAB should appear
    const tabRoutes = [
      '/discover',
      '/history', 
      '/grocery',
      '/meal-plan',
      '/settings',
      '/(tabs)',  // Root tab navigator
      '/',        // Home/index
    ];
    
    // Check if current path is a main tab
    const isMainTab = tabRoutes.some(route => 
      pathname === route || 
      pathname.startsWith(route + '/') ||
      pathname === '/(tabs)/discover' ||
      pathname === '/(tabs)/history' ||
      pathname === '/(tabs)/grocery' ||
      pathname === '/(tabs)/meal-plan' ||
      pathname === '/(tabs)/settings'
    );
    
    // Hide on specific screens
    const hideOnPaths = [
      '/recipe/',
      '/cook-mode/',
      '/add-recipe',
      '/edit-recipe/',
      '/collection/',
      '/ocr-review',
    ];
    
    const shouldHide = hideOnPaths.some(path => pathname.includes(path));
    
    return isMainTab && !shouldHide;
  }, [pathname]);

  const handlePress = () => {
    haptics.medium();
    scale.value = withSpring(0.9, { damping: 15 }, () => {
      scale.value = withSpring(1, { damping: 15 });
    });
    setShowChat(true);
  };

  // Don't render anything if we shouldn't show
  // Note: We avoid using exiting animations here due to a race condition bug
  // with React Native's New Architecture (Fabric) on Android that causes crashes
  // when views with exit animations are removed during navigation transitions
  if (!shouldShow) {
    return null;
  }

  return (
    <>
      <Animated.View
        entering={FadeIn.duration(300).springify()}
        style={[
          styles.container,
          {
            bottom: TAB_BAR_HEIGHT + spacing.md,
            right: spacing.lg,
          },
        ]}
      >
        <Animated.View style={animatedStyle}>
          {/* Outer glow/shadow layer */}
          <RNView style={[styles.fabShadow, { shadowColor: colors.tint }]}>
            <TouchableOpacity
              style={styles.fabTouchable}
              onPress={handlePress}
              activeOpacity={0.9}
            >
              {/* Gradient background */}
              <LinearGradient
                colors={[colors.tint, '#E85A2A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.fabGradient}
              >
                {/* Inner content with icon */}
                <RNView style={styles.fabContent}>
                  <Ionicons name="chatbubble-ellipses" size={24} color="#FFFFFF" />
                </RNView>
              </LinearGradient>
            </TouchableOpacity>
          </RNView>
        </Animated.View>
      </Animated.View>

      {/* General Cooking Chat Modal */}
      <RecipeChatModal
        isVisible={showChat}
        onClose={() => setShowChat(false)}
        // No recipe = general cooking mode
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 100,
  },
  fabShadow: {
    borderRadius: 28,
    // Soft glow shadow
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
  },
  fabTouchable: {
    borderRadius: 28,
    overflow: 'hidden',
  },
  fabGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
