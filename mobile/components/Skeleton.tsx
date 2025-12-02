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
});

export default Skeleton;

