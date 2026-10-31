import { useEffect, useRef, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useAuth } from '@clerk/expo';
import { ActivityIndicator, FlatList, Platform, Pressable, View } from 'react-native';
import type { SearchBarCommands } from 'react-native-screens';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import { Input, Text, Button, useColors } from '@/components/Themed';
import { SignInBanner } from '@/components/SignInBanner';
import { useRecipeOwnerGeneration } from '@/hooks/useOfflineLease';
import { useRecipeCount, useSearchRecipes, useSearchPublicRecipes, useSavedRecipes } from '@/hooks/useRecipes';
import { useDebouncedSearchQuery } from '@/hooks/useDebouncedSearchQuery';
import { typography } from '@/constants/Colors';
import type { RecipeListItem } from '@/types/recipe';
import { getRecipeSourcePresentation } from '@/lib/recipeSource';

type SearchRow = { id: string; heading: 'My recipes' | 'Discover' } | { id: string; recipe: RecipeListItem };
export default function SearchRoute() {
  const generation = useRecipeOwnerGeneration();
  return <LibrarySearch key={generation} />;
}
function LibrarySearch() {
  const colors = useColors();
  const router = useRouter();
  const active = useIsFocused();
  const { isSignedIn } = useAuth();
  const [query, setQuery] = useState('');
  // Session-only history retires with the account generation, along with the query.
  const [recent, setRecent] = useState<string[]>([]);
  const bar = useRef<SearchBarCommands>(null);
  useEffect(() => { if (active) bar.current?.focus(); else bar.current?.blur(); }, [active]);
  const remember = () => { const text = query.trim(); if (text) setRecent(rows => [text, ...rows.filter(row => row.toLowerCase() !== text.toLowerCase())].slice(0, 6)); };
  const chooseRecent = (text: string) => { setQuery(text); bar.current?.setText(text); bar.current?.focus(); };
  const debounced = useDebouncedSearchQuery(query);
  const { data: count } = useRecipeCount(undefined, active && Boolean(isSignedIn));
  const { total: savedTotal } = useSavedRecipes(active && Boolean(isSignedIn));
  const term = debounced.trim();
  const search = useSearchRecipes({ query: term, ownership: 'all' }, active && Boolean(isSignedIn && term));
  const discover = useSearchPublicRecipes({ query: term }, active && Boolean(term));
  const waiting = query.trim() !== term;
  const libraryTotal = (count?.count ?? 0) + (savedTotal ?? 0);
  const placeholder = isSignedIn && libraryTotal > 0 ? `Search ${libraryTotal} recipes` : 'Search recipes';
  const rows: SearchRow[] = query.trim() ? [
    ...(isSignedIn ? [{ id: 'my-heading', heading: 'My recipes' } as SearchRow] : []),
    ...(!waiting && isSignedIn ? search.recipes.map(recipe => ({ id: `my-${recipe.id}`, recipe })) : []),
    { id: 'discover-heading', heading: 'Discover' },
    ...(!waiting ? discover.recipes.map(recipe => ({ id: `public-${recipe.id}`, recipe })) : []),
  ] : [];
  const status = (scope: 'My recipes' | 'Discover') => {
    const result = scope === 'My recipes' ? search : discover;
    if (scope === 'My recipes' && !isSignedIn) return null;
    if (waiting || result.isFetching && !result.recipes.length) return <ActivityIndicator accessibilityLabel={`Searching ${scope}`} color={colors.tint} />;
    if (result.isError) return <><Text>Could not search {scope === 'My recipes' ? 'your library' : 'Discover'}.</Text><Button title="Try again" variant="secondary" onPress={() => void result.refetch()} /></>;
    if (!result.recipes.length) return <Text style={{ color: colors.textSecondary }}>No recipes found.</Text>;
    return null;
  };
  return <>
    {Platform.OS !== 'web' && <Stack.SearchBar ref={bar} autoFocus placeholder={placeholder} hideWhenScrolling={false} onChangeText={event => setQuery(event.nativeEvent.text)} onSearchButtonPress={remember} onCancelButtonPress={() => setQuery('')} />}
    <FlatList<SearchRow>
      contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ width: '100%', maxWidth: 720, alignSelf: 'center', padding: 16, gap: 12, paddingBottom: 32 }}
      data={rows} keyExtractor={item => item.id}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        {Platform.OS === 'web' && <Input value={query} onChangeText={setQuery} onSubmitEditing={remember} accessibilityLabel="Search library recipes" placeholder={placeholder} autoFocus returnKeyType="search" />}
        {!isSignedIn && <SignInBanner message="Sign in to search your library" />}
        {!query.trim() && <>
          {recent.length > 0 && <View><Text style={typography.headline}>Recent searches</Text>{recent.map(text => <Pressable key={text} accessibilityRole="button" onPress={() => chooseRecent(text)} style={{ minHeight: 44, justifyContent: 'center' }}><Text>{text}</Text></Pressable>)}<Button title="Clear recent searches" variant="ghost" onPress={() => setRecent([])} /></View>}
          <Pressable accessibilityRole="button" onPress={() => router.push('/ingredient-search')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.actionText }}>Search by ingredient</Text></Pressable>
        </>}
      </View>}
      renderItem={({ item }) => 'heading' in item ? <View style={{ gap: 12, marginTop: 8 }}><Text style={typography.headline}>{item.heading}</Text>{status(item.heading)}</View> : <Pressable accessibilityRole="button" accessibilityLabel={item.recipe.title} onPress={() => { remember(); router.push(`/recipe/${item.recipe.id}`); }} style={({ pressed }) => ({ flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 64, opacity: pressed ? 0.65 : 1 })}>
        <Image source={item.recipe.thumbnail_url ? { uri: item.recipe.thumbnail_url } : undefined} style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: colors.surface2 }} />
        <View style={{ flex: 1, gap: 2 }}><Text style={typography.cardTitle}>{item.recipe.title}</Text><Text style={{ ...typography.footnote, color: colors.textSecondary }}>{[item.id.startsWith('public-') ? item.recipe.extractor_display_name : getRecipeSourcePresentation(item.recipe.source_type).label, item.recipe.total_time].filter(Boolean).join(' · ')}</Text></View>
      </Pressable>}
      onEndReached={() => { if (waiting || !query.trim()) return; if (!search.isFetching && isSignedIn && search.hasNextPage) void search.fetchNextPage(); if (!discover.isFetching && discover.hasNextPage) void discover.fetchNextPage(); }}
      ListFooterComponent={search.isFetchingNextPage || discover.isFetchingNextPage ? <ActivityIndicator accessibilityLabel="Loading more recipes" /> : null}
    />
  </>;
}
