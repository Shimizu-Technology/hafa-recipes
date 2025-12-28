/**
 * Skeleton loading components with shimmer animation.
 * Shows placeholder shapes while content is loading.
 */

import { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, ViewStyle } from 'react-native';
import { useColors } from '@/components/Themed';
import { spacing, radius } from '@/constants/Colors';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

/**
 * Basic skeleton element with shimmer animation
 */
export function Skeleton({ 
  width = '100%', 
  height = 20, 
  borderRadius = radius.sm,
  style,
}: SkeletonProps) {
  const colors = useColors();
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [shimmerAnim]);

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: colors.textMuted,
          opacity,
        },
        style,
      ]}
    />
  );
}

/**
 * Skeleton recipe card matching the real RecipeCard layout
 */
export function SkeletonRecipeCard() {
  const colors = useColors();

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      {/* Thumbnail skeleton */}
      <Skeleton width={100} height={120} borderRadius={0} />
      
      {/* Content skeleton */}
      <View style={styles.cardContent}>
        {/* Title */}
        <Skeleton width="85%" height={18} style={{ marginBottom: spacing.xs }} />
        <Skeleton width="60%" height={18} />
        
        {/* Meta info */}
        <View style={styles.metaRow}>
          <Skeleton width={50} height={14} />
          <Skeleton width={40} height={14} />
        </View>
        
        {/* Tags */}
        <View style={styles.tagRow}>
          <Skeleton width={60} height={22} borderRadius={radius.full} />
          <Skeleton width={70} height={22} borderRadius={radius.full} />
        </View>
        
        {/* Footer */}
        <View style={styles.footer}>
          <Skeleton width={70} height={14} />
        </View>
      </View>
    </View>
  );
}

/**
 * Skeleton collection card matching CollectionCard layout
 */
export function SkeletonCollectionCard() {
  const colors = useColors();

  return (
    <View style={[styles.collectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      {/* Preview skeleton */}
      <Skeleton width="100%" height={80} borderRadius={0} />
      
      {/* Info skeleton */}
      <View style={styles.collectionInfo}>
        <Skeleton width="70%" height={14} style={{ marginBottom: 4 }} />
        <Skeleton width="40%" height={12} />
      </View>
    </View>
  );
}

/**
 * List of skeleton recipe cards
 */
export function SkeletonRecipeList({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRecipeCard key={i} />
      ))}
    </View>
  );
}

/**
 * Simple skeleton element for initial app loading (no theme dependency)
 */
function SimpleShimmer({ 
  width = '100%', 
  height = 20, 
  borderRadius: br = radius.sm,
  style,
}: SkeletonProps) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [shimmerAnim]);

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.15, 0.3],
  });

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius: br,
          backgroundColor: '#666',
          opacity,
        },
        style,
      ]}
    />
  );
}

/**
 * Full-page app loading skeleton - shows instead of splash screen
 * Uses simple styling without theme hooks (works during initial load)
 */
export function AppLoadingSkeleton() {
  return (
    <View style={styles.appLoadingContainer}>
      {/* Header area */}
      <View style={styles.appLoadingHeader}>
        <SimpleShimmer width={180} height={28} style={{ marginBottom: spacing.sm }} />
        <SimpleShimmer width={220} height={16} />
      </View>
      
      {/* Search bar skeleton */}
      <View style={styles.appLoadingSearch}>
        <SimpleShimmer width="100%" height={44} borderRadius={radius.lg} />
      </View>
      
      {/* Recipe card skeletons */}
      <View style={styles.list}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.simpleCard}>
            <SimpleShimmer width={100} height={120} borderRadius={0} />
            <View style={styles.cardContent}>
              <SimpleShimmer width="85%" height={18} style={{ marginBottom: spacing.xs }} />
              <SimpleShimmer width="60%" height={18} />
              <View style={styles.metaRow}>
                <SimpleShimmer width={50} height={14} />
                <SimpleShimmer width={40} height={14} />
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Horizontal list of skeleton collection cards
 */
export function SkeletonCollectionList({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.collectionList}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCollectionCard key={i} />
      ))}
    </View>
  );
}

/**
 * Skeleton for similar recipe card (horizontal scroll)
 */
export function SkeletonSimilarRecipeCard() {
  const colors = useColors();

  return (
    <View style={[styles.similarCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      {/* Image skeleton */}
      <Skeleton width={160} height={100} borderRadius={0} />
      
      {/* Content skeleton */}
      <View style={styles.similarCardContent}>
        <Skeleton width="90%" height={14} style={{ marginBottom: 4 }} />
        <Skeleton width="60%" height={14} />
        <Skeleton width={50} height={12} style={{ marginTop: spacing.xs }} />
      </View>
    </View>
  );
}

/**
 * Horizontal list of skeleton similar recipe cards
 */
export function SkeletonSimilarRecipes({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.similarList}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonSimilarRecipeCard key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
  },
  cardContent: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  tagRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  footer: {
    marginTop: spacing.sm,
  },
  list: {
    paddingHorizontal: spacing.lg,
  },
  collectionCard: {
    width: 120,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginRight: spacing.sm,
  },
  collectionInfo: {
    padding: spacing.sm,
  },
  collectionList: {
    flexDirection: 'row',
    paddingRight: spacing.lg,
  },
  appLoadingContainer: {
    flex: 1,
    paddingTop: 60, // Account for status bar
    backgroundColor: '#000', // Dark mode default for cleaner loading
  },
  appLoadingHeader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  appLoadingSearch: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  simpleCard: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#222',
    backgroundColor: '#111',
  },
  similarCard: {
    width: 160,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginRight: spacing.sm,
  },
  similarCardContent: {
    padding: spacing.sm,
  },
  similarList: {
    flexDirection: 'row',
    paddingRight: spacing.md,
  },
});

export default Skeleton;

