import React, { useEffect } from 'react';
import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { api } from '@/lib/api';
import { recipeKeys } from '@/hooks/useRecipes';
import { AccountHeaderButton, ImportTabIcon, TabHeaderBrand } from '@/components/TabChrome';

/** Configure the five primary cooking workflows and their shared app chrome. */
export default function TabLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const queryClient = useQueryClient();
  const { isSignedIn, isLoaded } = useAuth();

  // Prefetch both tabs' data when the user is authenticated
  useEffect(() => {
    // Wait for auth to be loaded AND user to be signed in
    if (!isLoaded || !isSignedIn) return;

    // Prefetch My Recipes (first page of infinite query)
    queryClient.prefetchInfiniteQuery({
      queryKey: recipeKeys.infinite(undefined),
      queryFn: ({ pageParam = 0 }) => api.getRecipes(20, pageParam),
      initialPageParam: 0,
      staleTime: 30_000,
    });

    // Prefetch Discover (first page of infinite query)
    queryClient.prefetchInfiniteQuery({
      queryKey: recipeKeys.discoverInfinite(undefined),
      queryFn: ({ pageParam = 0 }) => api.getPublicRecipes(20, pageParam),
      initialPageParam: 0,
      staleTime: 30_000,
    });

    // Prefetch popular tags for both scopes
    queryClient.prefetchQuery({
      queryKey: recipeKeys.popularTags('user'),
      queryFn: () => api.getPopularTags('user'),
      staleTime: 60_000,
    });

    queryClient.prefetchQuery({
      queryKey: recipeKeys.popularTags('public'),
      queryFn: () => api.getPopularTags('public'),
      staleTime: 60_000,
    });
  }, [queryClient, isSignedIn, isLoaded]);

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
