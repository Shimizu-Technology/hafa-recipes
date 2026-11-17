import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View as RNView } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import { SignInRequiredView } from '@/components/SignInRequiredView';
import { Button, Text, useColors } from '@/components/Themed';
import { fontFamily, layout, radius, spacing } from '@/constants/Colors';
import { useActiveRecipeLinks, useRevokeRecipeLink } from '@/hooks/useRecipeShareLink';
import { formatLinkCreated } from '@/lib/recipeShare';
import { appRoutes } from '@/lib/routes';
import { showToast } from '@/lib/toast';

/** Settings › Sharing links: every recipe with a private link that still opens, each one revocable. */
export default function SharingLinksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const links = useActiveRecipeLinks(!!isSignedIn);
  const revoke = useRevokeRecipeLink();
  const header = <Stack.Screen options={{ title: 'Sharing links' }} />;

  if (!isSignedIn) {
    return <>{header}<SignInRequiredView icon="link-outline" title="Sign in to manage links" message="Links you send to private recipes appear here, so you can turn them off." /></>;
  }

  const confirmRevoke = (recipeId: string, title: string) => Alert.alert(
    'Turn off this link?',
    `People you sent the link to “${title}” won’t be able to open it. Previews already in chats may still show the title and photo.`,
    [
      { text: 'Keep link', style: 'cancel' },
      {
        text: 'Turn off', style: 'destructive', onPress: () => {
          revoke.mutateAsync(recipeId).then(
            () => showToast({ message: 'Link turned off', tone: 'success' }),
            () => showToast({ message: 'Couldn’t turn off the link. Try again.', tone: 'error' }),
          );
        },
      },
    ],
  );

  const unavailable = (links.error as { response?: { status?: number } } | null)?.response?.status === 503;

  return (
    <ScrollView style={{ backgroundColor: colors.groupedBackground }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
      refreshControl={<RefreshControl refreshing={links.isRefetching} onRefresh={() => void links.refetch()} />}>
      {header}
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        Recipes you’ve sent with a private link. Anyone with one of these links can open the recipe until you turn the link off.
      </Text>
      {links.isLoading ? (
        <RNView style={styles.state}>
          <ActivityIndicator color={colors.textSecondary} />
          <Text style={[styles.stateText, { color: colors.textSecondary }]}>Checking your recipes…</Text>
        </RNView>
      ) : links.error ? (
        <RNView style={styles.state}>
          <Text style={[styles.stateText, { color: colors.textSecondary }]}>
            {unavailable ? 'Private links aren’t available yet.' : 'Couldn’t load your links. Check your connection and try again.'}
          </Text>
          {!unavailable && <Button title="Try again" variant="secondary" onPress={() => void links.refetch()} />}
        </RNView>
      ) : !links.data?.length ? (
        <RNView style={styles.state}>
          <Ionicons name="link-outline" size={36} color={colors.textMuted} />
          <Text style={[styles.stateTitle, { color: colors.text }]}>No active links</Text>
          <Text style={[styles.stateText, { color: colors.textSecondary }]}>When you send a link to a private recipe, it appears here so you can turn it off.</Text>
        </RNView>
      ) : (
        <RNView style={[styles.group, { backgroundColor: colors.backgroundElevated, borderColor: colors.hairline }]}>
          {links.data.map(({ recipe, createdAt }, index) => {
            const turningOff = revoke.isPending && revoke.variables === recipe.id;
            return (
              <RNView key={recipe.id} style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline }]}>
                <Pressable style={styles.rowMain} accessibilityRole="button" accessibilityLabel={`${recipe.title}, ${formatLinkCreated(createdAt)}`}
                  onPress={() => router.push(appRoutes.recipe(recipe.id))}>
                  <RecipeThumbnail uri={recipe.thumbnail_url} style={styles.thumb} accessible={false} placeholderIconName="restaurant-outline" placeholderIconSize={18} />
                  <RNView style={styles.rowCopy}>
                    <Text numberOfLines={2} style={[styles.rowTitle, { color: colors.text }]}>{recipe.title}</Text>
                    <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>{formatLinkCreated(createdAt)}</Text>
                  </RNView>
                </Pressable>
                <Pressable onPress={() => confirmRevoke(recipe.id, recipe.title)} disabled={turningOff} accessibilityRole="button"
                  accessibilityLabel={`Turn off link to ${recipe.title}`} style={styles.revoke}>
                  {turningOff ? <ActivityIndicator color={colors.destructive} /> : <Text style={[styles.revokeText, { color: colors.destructive }]}>Turn off</Text>}
                </Pressable>
              </RNView>
            );
          })}
        </RNView>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: layout.margin, gap: spacing.md },
  intro: { fontSize: 15, lineHeight: 21 },
  state: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  stateTitle: { fontSize: 17, lineHeight: 22, fontFamily: fontFamily.semibold },
  stateText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  group: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingVertical: 10, paddingHorizontal: 14, gap: spacing.sm },
  rowMain: { flex: 1, flexBasis: 200, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  thumb: { width: 44, height: 44, borderRadius: radius.sm, overflow: 'hidden' },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, lineHeight: 21, fontFamily: fontFamily.semibold },
  rowMeta: { fontSize: 14, lineHeight: 19 },
  revoke: { minHeight: 44, minWidth: 72, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' },
  revokeText: { fontSize: 16, lineHeight: 21, fontFamily: fontFamily.semibold },
});
