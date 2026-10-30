import React, { useEffect } from 'react';
import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';

import Colors, { fontFamily, fontSize } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { ScalePressable } from '@/components/Animated';
import { AccountHeaderButton, ImportTabIcon, TabHeaderBrand } from '@/components/TabChrome';
import { prefetchTabData } from '@/lib/tabPrefetch';

/** Configure the four primary cooking workflows and their shared app chrome. */
export default function TabLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const queryClient = useQueryClient();
  const { isSignedIn, isLoaded, userId } = useAuth();

  // `userId` is only an identity-change signal here. AuthTokenSync clears the
  // entire QueryClient in a parent layout effect before this descendant effect
  // runs, so private entries cannot cross accounts and the new account is warmed.
  useEffect(() => {
    if (!isLoaded) return;
    prefetchTabData(queryClient, Boolean(isSignedIn));
  }, [queryClient, isSignedIn, isLoaded, userId]);

  return (
    <Tabs
      initialRouteName="recipes"
      screenOptions={{
        tabBarButton: ({ href: _href, style, onPress, ...props }) => (
          <ScalePressable {...props} style={style} onPress={onPress} />
        ),
        tabBarActiveTintColor: colors.tabLabelSelected,
        tabBarInactiveTintColor: colors.tabIconDefault,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: colors.backgroundElevated,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          fontFamily: 'DMSans_600SemiBold',
        },
        tabBarItemStyle: {
          paddingTop: 2,
        },
        headerStyle: {
          backgroundColor: colors.background,
          shadowColor: 'transparent',
          elevation: 0,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        // Discover carries the brand; the other tabs name the screen you are on.
        headerTitleStyle: {
          fontFamily: fontFamily.semibold,
          fontSize: fontSize.lg,
          fontWeight: '600',
          color: colors.text,
        },
        headerRight: () => <AccountHeaderButton />,
        headerRightContainerStyle: { paddingRight: 16 },
      }}>
      <Tabs.Screen name="recipes" options={{
        title: 'Recipes', headerTitle: () => <TabHeaderBrand />,
        tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'book' : 'book-outline'} size={24} color={color} />,
      }} />
      <Tabs.Screen name="discover" options={{ href: null }} />
      <Tabs.Screen name="history" options={{ href: null }} />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Add',
          tabBarAccessibilityLabel: 'Add a recipe',
          tabBarIcon: ({ focused }) => <ImportTabIcon focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="planner"
        options={{
          title: 'Plan',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? 'calendar' : 'calendar-outline'}
              size={24}
              color={focused ? colors.tabIconSelected : color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="grocery"
        options={{
          title: 'Grocery',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? 'cart' : 'cart-outline'}
              size={24}
              color={focused ? colors.tabIconSelected : color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
