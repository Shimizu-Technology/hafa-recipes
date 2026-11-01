import { fontFamily } from '@/constants/Colors';
import { useRecipeOwnerGeneration } from '@/hooks/useOfflineLease';
import { useState } from 'react';
import { ScrollView, View, ActivityIndicator } from 'react-native';
import { CollectionGrid } from '@/components/CollectionGrid';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Button, Text, useColors } from '@/components/Themed';
import CreateCollectionModal from '@/components/CreateCollectionModal';
import { SignInBanner } from '@/components/SignInBanner';
import { useCollections } from '@/hooks/useCollections';

export default function CollectionsScreen() {
  const generation = useRecipeOwnerGeneration();
  return <CollectionsScreenContent key={generation} />;
}

function CollectionsScreenContent() {
  const router = useRouter();
  const colors = useColors();
  const { isSignedIn } = useAuth();
  const [showCreateCollectionModal, setShowCreateCollectionModal] = useState(false);
  const { data: collections, isLoading: isLoadingCollections, isError: isCollectionsError,
    isFetching: isFetchingCollections, refetch: refetchCollections } = useCollections(Boolean(isSignedIn));
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <Stack.Screen options={{ headerLargeTitleEnabled: true, headerLargeTitleStyle: { fontFamily: fontFamily.display, color: colors.text, fontSize: 32 }, title: 'Collections' }} />
    {!isSignedIn ? <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16 }}><SignInBanner message="Sign in to open your collections" /></ScrollView> : <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      {isLoadingCollections && <ActivityIndicator accessibilityLabel="Loading collections" />}
      {isCollectionsError && <View>
        <Text accessibilityRole="alert">{collections === undefined
          ? 'Couldn’t load your collections. Check your connection and try again.'
          : 'Couldn’t refresh your collections. Your last loaded collections are still shown.'}</Text>
        <Button title={isFetchingCollections ? 'Trying again…' : 'Try again'} disabled={isFetchingCollections} onPress={() => { void refetchCollections(); }} />
      </View>}
      {collections && <CollectionGrid collections={collections} onOpen={collection => router.push(`/collection/${collection.id}`)} onCreate={() => setShowCreateCollectionModal(true)} />}
    </ScrollView>}
    {isSignedIn && <CreateCollectionModal visible={showCreateCollectionModal} onClose={() => setShowCreateCollectionModal(false)} />}
  </View>;
}
