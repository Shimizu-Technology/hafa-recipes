import { useEffect } from 'react';
import { useAuth } from '@clerk/expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { Chip, Text, useColors } from '@/components/Themed';
import { useCurrentUserIdentity } from '@/hooks/useRecipes';
import { useRecipeScope } from '@/hooks/useRecipeScope';
import { HistoryScreen as LibraryScreen } from '@/app/(tabs)/history';
import { DiscoverScreen } from '@/app/(tabs)/discover';

export default function RecipesScreen() {
  const { isSignedIn, isLoaded } = useAuth();
  const identity = useCurrentUserIdentity(Boolean(isSignedIn));
  const owner = isSignedIn ? identity.data?.id ?? null : null;
  const { scope: requested } = useLocalSearchParams<{ scope?: string }>();
  const router = useRouter();
  const colors = useColors();
  const { scope, ready, select } = useRecipeScope(owner, requested);
  useEffect(() => { if (ready && requested) router.setParams({ scope: undefined }); }, [ready, requested, router]);
  if (!isLoaded || (isSignedIn && !owner && !identity.isError) || !ready) return <ActivityIndicator accessibilityLabel="Loading recipes" />;
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Recipe scope">
      {(['library', 'discover'] as const).map((value) => <Chip key={value}
        label={value === 'library' ? 'My Library' : 'Discover'} selected={scope === value}
        accessibilityRole="radio"
        onPress={() => select(value)} />)}
    </View>
    {identity.isError && isSignedIn && <Text>Could not load your account. Discover is available while you reconnect.</Text>}
    {scope === 'library' ? <LibraryScreen /> : <DiscoverScreen />}
  </View>;
}
