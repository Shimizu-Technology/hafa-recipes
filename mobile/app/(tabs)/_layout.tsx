import { useEffect } from 'react';
import { Tabs } from 'expo-router/js-tabs';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';
import { HafaTabBar } from '@/components/chrome/HafaTabBar';
import { prefetchTabData } from '@/lib/tabPrefetch';

export const unstable_settings = { initialRouteName: 'recipes' };

/** Library · Discover · Import · Plan · Grocery, drawn by Håfa so every OS gets the same bar. */
export default function TabLayout() {
  const queryClient = useQueryClient();
  const { isSignedIn, isLoaded, userId } = useAuth();
  // Parent AuthTokenSync clears private queries before warming a new account.
  useEffect(() => {
    if (isLoaded) prefetchTabData(queryClient, Boolean(isSignedIn));
  }, [queryClient, isSignedIn, isLoaded, userId]);
  return <Tabs tabBar={props => <HafaTabBar {...props} />} screenOptions={{ headerShown: false, tabBarHideOnKeyboard: true }}>
    <Tabs.Screen name="recipes" options={{ title: 'Library' }} />
    <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
    <Tabs.Screen name="planner" options={{ title: 'Plan' }} />
    <Tabs.Screen name="grocery" options={{ title: 'Grocery' }} />
  </Tabs>;
}
