import { useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { ActivityIndicator, FlatList, Platform, Pressable, View } from 'react-native';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import { Input, Text, Button, useColors } from '@/components/Themed';
import { SignInBanner } from '@/components/SignInBanner';
import { useRecipeOwnerGeneration } from '@/hooks/useOfflineLease';
import { useRecipeCount, useSearchRecipes } from '@/hooks/useRecipes';
import { useDebouncedSearchQuery } from '@/hooks/useDebouncedSearchQuery';
import { typography } from '@/constants/Colors';

export default function SearchRoute() {
  const generation = useRecipeOwnerGeneration();
  return <LibrarySearch key={generation} />;
}

function LibrarySearch() {
  const colors = useColors();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const [query, setQuery] = useState('');
  const debounced = useDebouncedSearchQuery(query);
  const { data: count } = useRecipeCount(undefined, Boolean(isSignedIn));
  const term = debounced.trim();
  const search = useSearchRecipes({ query: term, ownership: 'all' }, Boolean(isSignedIn && term));
  const pending = query.trim() !== term || (search.isFetching && search.recipes.length === 0);
  const placeholder = `Search ${count?.count ?? 0} recipes`;
  return <>
    {Platform.OS !== 'web' && <Stack.SearchBar autoFocus placeholder={placeholder} hideWhenScrolling={false} onChangeText={event => setQuery(event.nativeEvent.text)} onCancelButtonPress={() => setQuery('')} />}
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
      data={isSignedIn && query.trim() && !pending && !search.isError ? search.recipes : []}
      keyExtractor={item => item.id}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        {Platform.OS === 'web' && <Input value={query} onChangeText={setQuery} accessibilityLabel="Search library recipes" placeholder={placeholder} autoFocus returnKeyType="search" />}
        {!isSignedIn && <SignInBanner message="Sign in to search your library" />}
        {!query.trim() ? <Pressable accessibilityRole="button" onPress={() => router.push('/ingredient-search')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.actionText }}>Search by ingredients</Text></Pressable> : isSignedIn ? <>
          <Text style={typography.headline}>My recipes</Text>
          {pending && <ActivityIndicator accessibilityLabel="Searching your library" color={colors.tint} />}
          {search.isError && <><Text>Could not search your library.</Text><Button title="Try again" variant="secondary" onPress={() => void search.refetch()} /></>}
          {!pending && !search.isError && search.recipes.length === 0 && <Text style={{ color: colors.textSecondary }}>No recipes found.</Text>}
        </> : null}
      </View>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={item.title} onPress={() => router.push(`/recipe/${item.id}`)} style={({ pressed }) => ({ flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 64, opacity: pressed ? 0.65 : 1 })}>
        <RecipeThumbnail uri={item.thumbnail_url} accessible={false} placeholderIconSize={22} style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: colors.surface2 }} />
        <View style={{ flex: 1, gap: 2 }}><Text style={typography.cardTitle}>{item.title}</Text><Text style={{ ...typography.footnote, color: colors.textSecondary }}>{[item.source_type, item.total_time].filter(Boolean).join(' · ')}</Text></View>
      </Pressable>}
      onEndReached={() => { if (isSignedIn && query.trim() && !pending && !search.isFetching && search.hasNextPage) void search.fetchNextPage(); }}
      ListFooterComponent={search.isFetchingNextPage ? <ActivityIndicator accessibilityLabel="Loading more recipes" /> : null}
    />
  </>;
}
