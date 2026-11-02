import { StyleSheet, View as RNView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { RecipeHero } from '@/components/RecipeHero';
import { RecipeDetailScroll } from '@/components/RecipeDetailChrome';
import { Skeleton } from '@/components/Skeleton';
import { Text, useColors } from '@/components/Themed';
import { fontFamily, fontSize, fontWeight, radius, spacing } from '@/constants/Colors';
import { useTextSize } from '@/hooks/useTextSize';
import type { RecipePreview } from '@/lib/recipePreview';

/**
 * Cold-load view for a recipe already seen in a list: the photo, title and
 * summary appear at once, with the body as a skeleton. It offers no recipe
 * actions; those appear only once the full recipe (and its ownership) loads.
 */
export function RecipeDetailPreview({ preview }: { preview: RecipePreview }) {
  const colors = useColors();
  const { scaleFontSize } = useTextSize();
  const sourceUrl = preview.sourceUrl ?? '';

  return (
    <RecipeDetailScroll
      title={preview.title}
      expectHero={Boolean(preview.thumbnailUrl?.trim())}
      contentContainerStyle={styles.scrollContent}
      hero={<RecipeHero
        photoOnly
        recipeTitle={preview.title}
        sourceUrl={sourceUrl}
        thumbnailUrl={preview.thumbnailUrl}
        onOpenSource={() => {}}
        interactive={false}
      />}
    >
      <RNView style={styles.content}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text, fontSize: scaleFontSize(28), lineHeight: scaleFontSize(34) }]}
        >
          {preview.title}
        </Text>
        {(preview.servings || preview.totalTime) && (
          <RNView style={styles.metaRow}>
            {preview.servings ? (
              <RNView style={[styles.metaItem, { backgroundColor: colors.backgroundSecondary }]}>
                <Ionicons name="people-outline" size={18} color={colors.actionText} />
                <Text style={[styles.metaValue, { color: colors.text }]}>{preview.servings}</Text>
                <Text style={[styles.metaLabel, { color: colors.textMuted }]}>servings</Text>
              </RNView>
            ) : null}
            {preview.totalTime ? (
              <RNView style={[styles.metaItem, { backgroundColor: colors.backgroundSecondary }]}>
                <Ionicons name="time-outline" size={18} color={colors.actionText} />
                <Text style={[styles.metaValue, { color: colors.text }]}>{preview.totalTime}</Text>
              </RNView>
            ) : null}
          </RNView>
        )}
        <RNView
          accessible
          accessibilityLabel="Loading recipe details"
          accessibilityState={{ busy: true }}
          style={styles.body}
        >
          <RNView style={styles.tabRow}>
            {[96, 72, 92].map((width) => (
              <Skeleton key={width} width={width} height={36} borderRadius={radius.full} />
            ))}
          </RNView>
          {['70%', '55%', '80%', '62%', '48%', '74%'].map((width, index) => (
            <RNView key={index} style={styles.lineRow}>
              <Skeleton width={20} height={20} borderRadius={radius.full} />
              <Skeleton width={width} height={16} />
            </RNView>
          ))}
        </RNView>
      </RNView>
    </RecipeDetailScroll>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1 },
  content: { padding: spacing.md },
  title: { fontSize: fontSize.xxl, fontFamily: fontFamily.display, marginBottom: spacing.md },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  metaValue: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  metaLabel: { fontSize: fontSize.sm },
  body: { marginTop: spacing.md, gap: spacing.md },
  tabRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
