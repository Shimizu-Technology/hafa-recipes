import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View as RNView } from 'react-native';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/expo';

import { Button, Text, useColors } from '@/components/Themed';
import { RecipeDetailRow } from '@/components/RecipeDetailRow';
import { fontFamily, layout, radius, spacing } from '@/constants/Colors';
import { useRecipeQuery as useQuery } from '@/hooks/useRecipeQuery';
import { sharedSaveProblem, useSaveSharedRecipe, type SharedSaveProblem } from '@/hooks/useSaveSharedRecipe';
import { api, API_BASE_URL } from '@/lib/api';
import { openRecipeSource } from '@/lib/openRecipeSource';
import { classifyRecipeLinkKey } from '@/lib/recipeLinkRoute';
import { formatShareIngredient, getSourceCredit } from '@/lib/recipeShare';
import { getCookingNotes } from '@/lib/recipeTrust';
import { guestRecipeIntent } from '@/lib/guestRecipeIntent';
import { showToast } from '@/lib/toast';

/**
 * hafa-recipes.com/r/<key> opened in the app. A recipe ID goes to the full recipe screen; an unlisted
 * key shows the shared recipe with Save, which copies it privately into the viewer's library.
 */
export default function SharedRecipeScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const target = classifyRecipeLinkKey(key);
  if (target?.kind === 'recipe') return <Redirect href={{ pathname: '/recipe/[id]', params: { id: target.id } }} />;
  return <UnlistedRecipe linkKey={target?.kind === 'unlisted' ? target.key : null} />;
}

function UnlistedRecipe({ linkKey }: { linkKey: string | null }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [photoFailed, setPhotoFailed] = useState(false);
  const { userId, sessionId } = useAuth();
  const save = useSaveSharedRecipe(linkKey);
  const [problem, setProblem] = useState<SharedSaveProblem | null>(null);
  const { data: recipe, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['sharedRecipe', linkKey],
    queryFn: ({ signal }) => api.getSharedRecipe(linkKey!, signal),
    enabled: !!linkKey,
    retry: (count: number, failure: unknown) => count < 1 && (failure as { status?: number })?.status !== 404,
  });
  const runSave = async (guard?: () => void) => {
    setProblem(null);
    try {
      const { recipe_id } = await save.mutateAsync(undefined);
      guard?.();
      showToast({ message: 'Saved to your library', tone: 'success' });
      router.replace({ pathname: '/recipe/[id]', params: { id: recipe_id } });
    } catch (failure) {
      setProblem(sharedSaveProblem(failure));
    }
  };
  const handleSave = () => {
    if (!linkKey || save.isPending) return;
    if (!userId) {
      // The key stays in memory; after sign-in AuthProtection brings the viewer back here to finish.
      guestRecipeIntent.start(linkKey, 'shared-save');
      router.push('/(auth)/sign-in');
      return;
    }
    void runSave();
  };
  // Finish a save that began before sign-in, once, for this session only.
  const loaded = !!recipe;
  useEffect(() => {
    if (!linkKey || !userId || !sessionId || !loaded) return;
    const intent = guestRecipeIntent.take(linkKey, sessionId);
    if (intent?.action === 'shared-save') void runSave(intent.guard);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey, userId, sessionId, loaded]);
  const header = <Stack.Screen options={{ title: 'Shared recipe', headerBackTitle: 'Back' }} />;

  if (linkKey && isLoading) {
    return <RNView style={[styles.center, { backgroundColor: colors.background }]}>{header}<ActivityIndicator color={colors.actionText} /></RNView>;
  }
  if (!linkKey || !recipe) {
    const missing = !linkKey || (error as { status?: number } | null)?.status === 404;
    return (
      <RNView style={[styles.center, { backgroundColor: colors.background }]}>
        {header}
        <Ionicons name="link-outline" size={44} color={colors.textMuted} />
        <Text style={[styles.unavailableTitle, { color: colors.text }]}>{missing ? 'This recipe isn’t available' : 'Couldn’t open this recipe'}</Text>
        <Text style={[styles.unavailableText, { color: colors.textSecondary }]}>
          {missing ? 'It may be private, or the link was turned off. Ask the person who sent it for a new link.' : 'Check your connection and try again.'}
        </Text>
        {!missing && <Button title="Try again" onPress={() => void refetch()} loading={isFetching} />}
        <Button title="Go to Library" variant="ghost" onPress={() => router.replace('/(tabs)/recipes')} />
      </RNView>
    );
  }

  const source = getSourceCredit(recipe.source_url, null);
  const facts = [recipe.servings ? `Serves ${recipe.servings}` : null, recipe.time].filter(Boolean).join(' · ');
  const components = recipe.components.filter(component => component.ingredients.length || component.steps.length);
  const named = components.length > 1;
  const steps = components.flatMap(component => component.steps.filter(step => step.trim())
    .map((step, index) => ({ step, heading: named && index === 0 ? component.name : '' })));
  const notes = getCookingNotes(recipe.notes);
  const estimated = components.some(component => component.ingredients.some(ingredient => formatShareIngredient(ingredient).startsWith('≈')));

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
      {header}
      {!photoFailed && (
        // Memory only: an unlisted recipe's image shouldn't persist in the shared disk cache.
        <Image source={{ uri: `${API_BASE_URL}/public/r/${encodeURIComponent(linkKey)}/og.jpg` }} cachePolicy="memory"
          accessible={false} style={[styles.photo, { backgroundColor: colors.placeholder }]} contentFit="cover" onError={() => setPhotoFailed(true)} />
      )}
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{recipe.title}</Text>
      <Text style={[styles.credit, { color: colors.text }]}>Shared by {recipe.creator}</Text>
      {facts ? <Text style={[styles.meta, { color: colors.textSecondary }]}>{facts}</Text> : null}
      <RNView style={[styles.notice, { backgroundColor: colors.surface2 }]}>
        <Ionicons name="lock-closed-outline" size={16} color={colors.textSecondary} />
        <Text style={[styles.noticeText, { color: colors.textSecondary }]}>Shared with a private link. Only people with the link can open it.</Text>
      </RNView>
      <RNView testID="shared-save" style={styles.save}>
        {problem?.kind === 'own'
          ? <Button title="Open your recipe" variant="secondary" onPress={() => router.replace({ pathname: '/recipe/[id]', params: { id: recipe.id } })} />
          : problem?.kind !== 'unavailable' && <Button title={userId ? 'Save to my library' : 'Sign in to save'} onPress={handleSave} loading={save.isPending} />}
        <Text accessibilityLiveRegion="polite" style={[styles.meta, { color: problem && problem.kind !== 'own' ? colors.error : colors.textSecondary }]}>
          {problem ? problem.message : 'Saves a private copy you can scale, plan and cook from.'}
        </Text>
      </RNView>
      {source && (
        <RNView style={[styles.group, { backgroundColor: colors.backgroundElevated, borderColor: colors.hairline }]}>
          <RecipeDetailRow icon="play-circle-outline" title="Original" value={source.label} accessibilityRole="link"
            onPress={() => void openRecipeSource(source.url)} />
        </RNView>
      )}

      {components.some(component => component.ingredients.length) && <Text accessibilityRole="header" style={[styles.section, { color: colors.text }]}>Ingredients</Text>}
      {components.map((component, index) => component.ingredients.length ? (
        <RNView key={`ingredients-${index}`} style={styles.block}>
          {named && component.name ? <Text style={[styles.subhead, { color: colors.text }]}>{component.name}</Text> : null}
          {component.ingredients.map((ingredient, row) => (
            <RNView key={row} style={[styles.ingredient, { borderBottomColor: colors.hairline }]}>
              <Text style={[styles.body, { color: colors.text }]}>{formatShareIngredient(ingredient)}</Text>
            </RNView>
          ))}
        </RNView>
      ) : null)}

      {steps.length > 0 && <Text accessibilityRole="header" style={[styles.section, { color: colors.text }]}>Steps</Text>}
      {steps.map(({ step, heading }, index) => (
        <RNView key={index} style={styles.block}>
          {heading ? <Text style={[styles.subhead, { color: colors.text }]}>{heading}</Text> : null}
          <RNView style={styles.step}>
            <Text style={[styles.stepNumber, { color: colors.actionText }]}>{index + 1}</Text>
            <Text style={[styles.body, styles.stepText, { color: colors.text }]}>{step}</Text>
          </RNView>
        </RNView>
      ))}

      {notes ? <Text style={[styles.body, { color: colors.textSecondary }]}>Notes: {notes}</Text> : null}
      <Text style={[styles.meta, { color: colors.textMuted }]}>
        {estimated ? '≈ marks an amount Håfa estimated. ' : ''}Recipes may contain AI estimates. Check quantities and cooking instructions before you begin.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: layout.margin, gap: spacing.md },
  unavailableTitle: { fontSize: 20, lineHeight: 25, fontFamily: fontFamily.semibold, textAlign: 'center' },
  unavailableText: { fontSize: 16, lineHeight: 22, textAlign: 'center', maxWidth: 360 },
  content: { padding: layout.margin, gap: spacing.sm },
  photo: { width: '100%', aspectRatio: 1200 / 630, borderRadius: radius.lg, marginBottom: spacing.sm },
  title: { fontSize: 30, lineHeight: 36, fontFamily: fontFamily.recipeTitle },
  credit: { fontSize: 16, lineHeight: 21, fontFamily: fontFamily.semibold },
  meta: { fontSize: 14, lineHeight: 20 },
  save: { gap: spacing.sm, marginBottom: spacing.sm },
  notice: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', padding: 12, borderRadius: radius.md, marginVertical: spacing.sm },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 20 },
  group: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  section: { fontSize: 20, lineHeight: 25, fontFamily: fontFamily.semibold, marginTop: spacing.lg },
  subhead: { fontSize: 16, lineHeight: 21, fontFamily: fontFamily.semibold, marginTop: spacing.sm },
  block: { gap: 2 },
  ingredient: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  body: { fontSize: 17, lineHeight: 24 },
  step: { flexDirection: 'row', gap: 12, paddingVertical: 6 },
  stepNumber: { width: 22, fontSize: 17, lineHeight: 24, fontFamily: fontFamily.semibold },
  stepText: { flex: 1 },
});
