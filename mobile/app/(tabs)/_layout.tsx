import React, { useEffect } from 'react';
import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { AccountHeaderButton, ImportTabIcon, TabHeaderBrand } from '@/components/TabChrome';
import { prefetchTabData } from '@/lib/tabPrefetch';

/** Configure the five primary cooking workflows and their shared app chrome. */
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
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
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
        headerTitle: () => <TabHeaderBrand />,
        headerRight: () => <AccountHeaderButton />,
        headerRightContainerStyle: { paddingRight: 16 },
      }}>
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? 'globe' : 'globe-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Library',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? 'book' : 'book-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Import',
          tabBarAccessibilityLabel: 'Import a recipe',
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
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="grocery"
        options={{
          title: 'Shop',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? 'cart' : 'cart-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
