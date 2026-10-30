import { useRecipeOwnerGeneration } from '@/hooks/useOfflineLease';
import { useIsFocused } from 'expo-router/react-navigation';
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
  const generation = useRecipeOwnerGeneration();
  return <RecipesScreenContent key={generation} />;
}

function RecipesScreenContent() {
  const focused = useIsFocused();
  const { isSignedIn, isLoaded } = useAuth();
  const identity = useCurrentUserIdentity(Boolean(isSignedIn));
  const owner = isSignedIn ? identity.data?.id ?? null : null;
  const { scope: requested } = useLocalSearchParams<{ scope?: string }>();
  const router = useRouter();
  const colors = useColors();
  const { scope, ready, select } = useRecipeScope(owner, requested);
  useEffect(() => { if (ready && requested) router.setParams({ scope: undefined }); }, [ready, requested, router]);
  if (!isLoaded || (isSignedIn && !owner && !identity.isError) || !ready) return <ActivityIndicator accessibilityLabel="Loading recipes" />;
  return <View key={owner ?? 'guest'} style={{ flex: 1, backgroundColor: colors.background }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Recipe scope">
      {(['library', 'discover'] as const).map((value) => <Chip key={value}
        label={value === 'library' ? 'My Library' : 'Discover'} selected={scope === value}
        accessibilityRole="radio"
        onPress={() => select(value)} />)}
    </View>
    {identity.isError && isSignedIn && <Text>Could not load your account. Discover is available while you reconnect.</Text>}
    {(['library', 'discover'] as const).map(value => <View key={value}
      style={{ flex: 1, display: scope === value ? 'flex' : 'none' }}
      pointerEvents={scope === value ? 'auto' : 'none'} accessibilityElementsHidden={scope !== value}
      importantForAccessibility={scope === value ? 'auto' : 'no-hide-descendants'}>
      {value === 'library' ? <LibraryScreen active={focused && scope === value} /> : <DiscoverScreen active={focused && scope === value} />}
    </View>)}
  </View>;
}
