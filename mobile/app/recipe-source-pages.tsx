import { useState } from 'react';
import { Alert, Image, ScrollView, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Text, useColors } from '@/components/Themed';
import { api } from '@/lib/api';
import { useCurrentUserIdentity, useRecipe } from '@/hooks/useRecipes';

/** Original pages never enter public recipe data or the image disk cache. */
export default function RecipeSourcePagesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const identity = useCurrentUserIdentity();
  const owner = identity.data?.id;
  const { data: recipe } = useRecipe(id);
  const queryClient = useQueryClient();
  const colors = useColors();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState(false);
  const pages = useQuery({ queryKey: ['recipe-source-pages', owner, id],
    queryFn: () => api.getRecipeSourcePages(id), enabled: Boolean(owner && id) && !removed,
    staleTime: 0, gcTime: 0, refetchInterval: 45_000 });
  const values = pages.data?.pages || [];
  const index = Math.min(page, Math.max(0, values.length - 1));
  const panelWidth = width > 700 ? (width - 48) / 2 : Math.max(280, width - 48);
  const navigatePage = (next: number) => { setPage(next); setZoom(1); };
  const remove = () => Alert.alert('Remove original pages?', 'Your extracted recipe will stay saved. The original pages will be removed privately.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove pages', style: 'destructive', onPress: () => {
      setRemoving(true);
      void api.removeRecipeSourcePages(id).then(() => {
        setRemoved(true);
        queryClient.removeQueries({ queryKey: ['recipe-source-pages', owner, id] });
      }).catch(() => Alert.alert('Could not remove pages', 'Try again when you are connected.'))
        .finally(() => setRemoving(false));
    } },
  ]);
  const components = recipe?.extracted.components || [];
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <Stack.Screen options={{ title: 'Original pages' }} />
    <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
      <Text>Private · Only you can open these pages. They are never published.</Text>
      {pages.isError && <><Text>Could not load original pages. Reconnect to view them.</Text><Button title="Retry" onPress={() => { void pages.refetch(); }} /></>}
      {pages.isLoading && <Text>Loading original pages…</Text>}
      {(removed || pages.isSuccess && !values.length) && <Text>No original pages are saved with this recipe.</Text>}
      {values.length > 0 && !removed && !pages.isError && <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Button title="Previous page" disabled={index === 0} onPress={() => navigatePage(index - 1)} />
          <Text accessibilityLiveRegion="polite">Page {index + 1} of {values.length}</Text>
          <Button title="Next page" disabled={index === values.length - 1} onPress={() => navigatePage(index + 1)} />
          <Button title="Zoom out" disabled={zoom <= 1} onPress={() => setZoom(Math.max(1, zoom - 0.5))} />
          <Button title="Zoom in" disabled={zoom >= 3} onPress={() => setZoom(Math.min(3, zoom + 0.5))} />
        </View>
        <Text>Compare the panels side by side. Swipe sideways to see the recipe on a small screen.</Text>
        <ScrollView horizontal contentContainerStyle={{ gap: 16 }}>
          <View style={{ width: panelWidth }}>
            <Text accessibilityRole="header">Original page {index + 1}</Text>
            <ScrollView horizontal style={{ height: 420 }}>
              <ScrollView nestedScrollEnabled>
                <Image source={{ uri: values[index].url, cache: 'reload' }}
                  accessibilityLabel={`Original recipe page ${index + 1}`}
                  style={{ width: panelWidth * zoom, height: 420 * zoom }} resizeMode="contain" />
              </ScrollView>
            </ScrollView>
          </View>
          <View style={{ width: panelWidth, gap: 8 }}>
            <Text accessibilityRole="header">{recipe?.extracted.title || 'Extracted recipe'}</Text>
            {(components.length ? components : [{ name: '', ingredients: recipe?.extracted.ingredients || [], steps: recipe?.extracted.steps || [] }]).map((part, partIndex) => <View key={partIndex} style={{ gap: 8 }}>
              {!!part.name && <Text accessibilityRole="header">{part.name}</Text>}
              {part.ingredients?.map((item, i) => <Text key={`ingredient-${i}`}>{[item.quantity, item.unit, item.name].filter(Boolean).join(' ')}</Text>)}
              {part.steps?.map((step, i) => <Text key={`step-${i}`}>{i + 1}. {step}</Text>)}
            </View>)}
          </View>
        </ScrollView>
        <Button title={removing ? 'Removing pages…' : 'Remove pages'} variant="outline" disabled={removing} onPress={remove} />
      </>}
    </ScrollView>
  </View>;
}
