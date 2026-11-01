import { useEffect } from 'react';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';
import { useColorScheme } from '@/components/useColorScheme';
import { useColors } from '@/components/Themed';
import { prefetchTabData } from '@/lib/tabPrefetch';

export const unstable_settings = { initialRouteName: 'recipes' };

export default function TabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const queryClient = useQueryClient();
  const { isSignedIn, isLoaded, userId } = useAuth();
  // Parent AuthTokenSync clears private queries before warming a new account.
  useEffect(() => {
    if (isLoaded) prefetchTabData(queryClient, Boolean(isSignedIn));
  }, [queryClient, isSignedIn, isLoaded, userId]);
  return <NativeTabs unstable_nativeProps={{ colorScheme }} tintColor={colors.tint} minimizeBehavior="onScrollDown">
    <NativeTabs.Trigger name="recipes">
      <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf="books.vertical" src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="book-outline" />} />
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="discover">
      <NativeTabs.Trigger.Label>Discover</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf="sparkles" src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="sparkles-outline" />} />
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="planner">
      <NativeTabs.Trigger.Label>Plan</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf="calendar" src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="calendar-outline" />} />
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="grocery">
      <NativeTabs.Trigger.Label>Grocery</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf="cart" src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="cart-outline" />} />
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="search" role="search">
      <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf="magnifyingglass" src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="search-outline" />} />
    </NativeTabs.Trigger>
  </NativeTabs>;
}
