/**
 * Floating Action Button (FAB) for the Cooking Assistant.
 * 
 * Appears on main tabs to provide quick access to the general cooking chat.
 * Positioned in bottom-right corner, above the tab bar.
 */

import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View as RNView } from 'react-native';
import { usePathname } from 'expo-router';
import { useAuth } from '@clerk/expo';
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
import { brand, fontFamily, fontSize, radius, spacing } from '@/constants/Colors';
import { floatingChatBottom, isFloatingChatPath } from '@/lib/floatingChatLayout';
import { useGuestPromptHeight } from '../lib/guestPromptLayout';

/** Render the cooking assistant shortcut on primary recipe-workflow tabs. */
export default function FloatingChatButton() {
  const colors = useColors();
  const { isSignedIn } = useAuth();
  const pathname = usePathname();
  const guestPromptHeight = useGuestPromptHeight();
  const [showChat, setShowChat] = useState(false);
  
  // Scale animation for press feedback
  const scale = useSharedValue(1);
  
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const shouldShow = React.useMemo(() => {
    // Hide on specific screens
    const hideOnPaths = [
      '/recipe/',
      '/cook-mode/',
      '/add-recipe',
      '/edit-recipe/',
      '/collection/',
      '/ocr-review',
      '/paste-recipe',
    ];
    
    const shouldHide = hideOnPaths.some(path => pathname.includes(path));
    
    return isFloatingChatPath(pathname) && !shouldHide;
  }, [pathname]);
  const canRender = shouldShow && (Boolean(isSignedIn) || guestPromptHeight > 0);

  React.useEffect(() => {
    if (!canRender && showChat) {
      setShowChat(false);
    }
  }, [canRender, showChat]);

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
  if (!canRender) {
    return null;
  }

  return (
    <>
      <Animated.View
        entering={FadeIn.duration(300).springify()}
        style={[
          styles.container,
          {
            bottom: floatingChatBottom(Boolean(isSignedIn), guestPromptHeight),
            right: spacing.lg,
          },
        ]}
      >
        <Animated.View style={animatedStyle}>
          <RNView style={[styles.fabShadow, { shadowColor: colors.tint }]}>
            <TouchableOpacity
              style={styles.fabTouchable}
              onPress={handlePress}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel="Ask Håfa cooking assistant"
              accessibilityHint="Opens cooking help"
            >
              <LinearGradient
                colors={[colors.tint, brand.reefBright]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.fabGradient}
              >
                <RNView style={styles.fabContent}>
                  <Ionicons name="sparkles" size={18} color="#FFFFFF" />
                  <Text style={styles.fabLabel}>Ask Håfa</Text>
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
    borderRadius: radius.full,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.24,
    shadowRadius: 10,
    elevation: 8,
  },
  fabTouchable: {
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  fabGradient: {
    minHeight: 52,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  fabContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  fabLabel: {
    color: '#FFFFFF',
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.sm,
  },
});
