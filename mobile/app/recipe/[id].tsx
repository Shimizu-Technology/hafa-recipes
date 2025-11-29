import { useState } from 'react';
import {
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  Linking,
  Share,
  View as RNView,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, View, Card, Chip, Divider, useColors } from '@/components/Themed';
import { useRecipe, useDeleteRecipe } from '@/hooks/useRecipes';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

type TabType = 'ingredients' | 'steps' | 'nutrition';

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabType>('ingredients');
  
  const { data: recipe, isLoading, error } = useRecipe(id);
  const deleteMutation = useDeleteRecipe();
  const [imageError, setImageError] = useState(false);

  const handleDelete = () => {
    Alert.alert(
      'Delete Recipe',
      'Are you sure you want to delete this recipe? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync(id);
              router.back();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete recipe');
            }
          },
        },
      ]
    );
  };

  const handleShare = async () => {
    if (!recipe) return;
    try {
      await Share.share({
        title: recipe.extracted.title,
        message: `Check out this recipe: ${recipe.extracted.title}\n\nSource: ${recipe.source_url}`,
        url: recipe.source_url,
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  const handleOpenSource = () => {
    if (recipe?.source_url) {
      Linking.openURL(recipe.source_url);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading recipe...
        </Text>
      </View>
    );
  }

  if (error || !recipe) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorEmoji}>😕</Text>
        <Text style={[styles.errorTitle, { color: colors.text }]}>
          Recipe not found
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={[styles.linkText, { color: colors.tint }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { extracted } = recipe;
  const sourceIcon = recipe.source_type === 'tiktok' 
    ? 'logo-tiktok' 
    : recipe.source_type === 'youtube' 
      ? 'logo-youtube' 
      : recipe.source_type === 'instagram' 
        ? 'logo-instagram' 
        : 'globe-outline';
  
  const sourceLabel = recipe.source_type === 'tiktok' 
    ? 'TikTok' 
    : recipe.source_type === 'youtube' 
      ? 'YouTube' 
      : recipe.source_type === 'instagram' 
        ? 'Instagram' 
        : 'Video';

  const tabs: { key: TabType; label: string }[] = [
    { key: 'ingredients', label: 'Ingredients' },
    { key: 'steps', label: 'Steps' },
    { key: 'nutrition', label: 'Nutrition' },
  ];

  return (
    <>
      <Stack.Screen 
        options={{ 
          headerTitle: 'Recipe',
          headerBackTitle: 'Back',
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerTintColor: colors.tint,
          headerTitleStyle: {
            color: colors.text,
            fontWeight: '600',
          },
          headerRight: () => (
            <RNView style={styles.headerButtons}>
              <TouchableOpacity onPress={handleShare} style={styles.headerButton}>
                <Ionicons name="share-outline" size={22} color={colors.tint} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDelete} style={styles.headerButton}>
                <Ionicons name="trash-outline" size={22} color={colors.error} />
              </TouchableOpacity>
            </RNView>
          ),
        }} 
      />
      
      <View style={styles.container}>
        <ScrollView 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
        >
          {/* Hero Image */}
          {recipe.thumbnail_url && !imageError ? (
            <Image 
              source={{ uri: recipe.thumbnail_url }} 
              style={styles.heroImage}
              onError={() => setImageError(true)}
            />
          ) : (
            <RNView style={[styles.placeholderHero, { backgroundColor: colors.tint + '15' }]}>
              <Ionicons name="restaurant-outline" size={64} color={colors.tint} />
            </RNView>
          )}

          {/* Content */}
          <RNView style={styles.content}>
            {/* Title */}
            <Text style={[styles.title, { color: colors.text }]}>
              {extracted.title}
            </Text>
            
            {/* Meta Row */}
            <RNView style={styles.metaRow}>
              {extracted.servings && (
                <RNView style={[styles.metaItem, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={styles.metaIcon}>👥</Text>
                  <Text style={[styles.metaValue, { color: colors.text }]}>
                    {extracted.servings}
                  </Text>
                  <Text style={[styles.metaLabel, { color: colors.textMuted }]}>
                    servings
                  </Text>
                </RNView>
              )}
              {extracted.times.total && (
                <RNView style={[styles.metaItem, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={styles.metaIcon}>⏱️</Text>
                  <Text style={[styles.metaValue, { color: colors.text }]}>
                    {extracted.times.total}
                  </Text>
                </RNView>
              )}
              {extracted.totalEstimatedCost && (
                <RNView style={[styles.metaItem, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={styles.metaIcon}>💰</Text>
                  <Text style={[styles.metaValue, { color: colors.text }]}>
                    ${extracted.totalEstimatedCost.toFixed(2)}
                  </Text>
                </RNView>
              )}
            </RNView>

            {/* Quality Badge */}
            {recipe.has_audio_transcript && (
              <RNView style={[styles.qualityBadge, { backgroundColor: colors.success + '15' }]}>
                <Text style={[styles.qualityText, { color: colors.success }]}>
                  🎤 High Quality · Audio Transcribed
                </Text>
              </RNView>
            )}

            {/* Tags */}
            {extracted.tags.length > 0 && (
              <RNView style={styles.tagContainer}>
                {extracted.tags.map((tag, index) => (
                  <Chip key={index} label={tag} size="sm" />
                ))}
              </RNView>
            )}

            {/* Source Button */}
            <TouchableOpacity 
              style={[styles.sourceButton, { borderColor: colors.border }]} 
              onPress={handleOpenSource}
              activeOpacity={0.7}
            >
              <Ionicons name={sourceIcon as any} size={20} color={colors.textSecondary} />
              <Text style={[styles.sourceButtonText, { color: colors.text }]}>
                View on {sourceLabel}
              </Text>
              <Ionicons name="open-outline" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            {/* Tabs */}
            <RNView style={[styles.tabContainer, { borderBottomColor: colors.border }]}>
              {tabs.map((tab) => (
                <TouchableOpacity
                  key={tab.key}
                  style={[
                    styles.tab,
                    activeTab === tab.key && { borderBottomColor: colors.tint },
                  ]}
                  onPress={() => setActiveTab(tab.key)}
                >
                  <Text 
                    style={[
                      styles.tabText, 
                      { color: activeTab === tab.key ? colors.tint : colors.textMuted },
                      activeTab === tab.key && styles.tabTextActive,
                    ]}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </RNView>

            {/* Tab Content */}
            <RNView style={styles.tabContent}>
              {activeTab === 'ingredients' && (
                <>
                  {extracted.components.map((component, compIndex) => (
                    <RNView key={compIndex} style={styles.componentSection}>
                      {extracted.components.length > 1 && (
                        <Text style={[styles.componentTitle, { color: colors.tint }]}>
                          {component.name}
                        </Text>
                      )}
                      {component.ingredients.map((ing, ingIndex) => (
                        <RNView key={ingIndex} style={styles.ingredientRow}>
                          <RNView style={[styles.bullet, { backgroundColor: colors.tint }]} />
                          <RNView style={styles.ingredientContent}>
                            <Text style={[styles.ingredientText, { color: colors.text }]}>
                              {ing.quantity && (
                                <Text style={styles.ingredientQty}>
                                  {ing.quantity} {ing.unit}{' '}
                                </Text>
                              )}
                              {ing.name}
                              {ing.notes && (
                                <Text style={[styles.ingredientNotes, { color: colors.textMuted }]}>
                                  {' '}({ing.notes})
                                </Text>
                              )}
                            </Text>
                            {ing.estimatedCost && (
                              <Text style={[styles.ingredientCost, { color: colors.textMuted }]}>
                                ${ing.estimatedCost.toFixed(2)}
                              </Text>
                            )}
                          </RNView>
                        </RNView>
                      ))}
                    </RNView>
                  ))}
                </>
              )}

              {activeTab === 'steps' && (
                <>
                  {extracted.components.map((component, compIndex) => (
                    <RNView key={compIndex} style={styles.componentSection}>
                      {extracted.components.length > 1 && (
                        <Text style={[styles.componentTitle, { color: colors.tint }]}>
                          {component.name}
                        </Text>
                      )}
                      {component.steps.map((step, stepIndex) => (
                        <RNView key={stepIndex} style={styles.stepRow}>
                          <RNView style={[styles.stepNumber, { backgroundColor: colors.tint }]}>
                            <Text style={styles.stepNumberText}>{stepIndex + 1}</Text>
                          </RNView>
                          <Text style={[styles.stepText, { color: colors.text }]}>
                            {step}
                          </Text>
                        </RNView>
                      ))}
                    </RNView>
                  ))}
                </>
              )}

              {activeTab === 'nutrition' && (
                <>
                  {/* Per Serving */}
                  {extracted.nutrition?.perServing && (
                    <RNView style={styles.nutritionSection}>
                      <Text style={[styles.nutritionTitle, { color: colors.text }]}>
                        Per Serving
                      </Text>
                      <RNView style={styles.nutritionGrid}>
                        {extracted.nutrition.perServing.calories && (
                          <RNView style={[styles.nutritionItem, { backgroundColor: colors.backgroundSecondary }]}>
                            <Text style={[styles.nutritionValue, { color: colors.tint }]}>
                              {extracted.nutrition.perServing.calories}
                            </Text>
                            <Text style={[styles.nutritionLabel, { color: colors.textMuted }]}>
                              Calories
                            </Text>
                          </RNView>
                        )}
                        {extracted.nutrition.perServing.protein && (
                          <RNView style={[styles.nutritionItem, { backgroundColor: colors.backgroundSecondary }]}>
                            <Text style={[styles.nutritionValue, { color: colors.tint }]}>
                              {extracted.nutrition.perServing.protein}g
                            </Text>
                            <Text style={[styles.nutritionLabel, { color: colors.textMuted }]}>
                              Protein
                            </Text>
                          </RNView>
                        )}
                        {extracted.nutrition.perServing.carbs && (
                          <RNView style={[styles.nutritionItem, { backgroundColor: colors.backgroundSecondary }]}>
                            <Text style={[styles.nutritionValue, { color: colors.tint }]}>
                              {extracted.nutrition.perServing.carbs}g
                            </Text>
                            <Text style={[styles.nutritionLabel, { color: colors.textMuted }]}>
                              Carbs
                            </Text>
                          </RNView>
                        )}
                        {extracted.nutrition.perServing.fat && (
                          <RNView style={[styles.nutritionItem, { backgroundColor: colors.backgroundSecondary }]}>
                            <Text style={[styles.nutritionValue, { color: colors.tint }]}>
                              {extracted.nutrition.perServing.fat}g
                            </Text>
                            <Text style={[styles.nutritionLabel, { color: colors.textMuted }]}>
                              Fat
                            </Text>
                          </RNView>
                        )}
                      </RNView>
                    </RNView>
                  )}

                  {/* Equipment */}
                  {extracted.equipment && extracted.equipment.length > 0 && (
                    <RNView style={styles.equipmentSection}>
                      <Text style={[styles.nutritionTitle, { color: colors.text }]}>
                        Equipment
                      </Text>
                      <RNView style={styles.equipmentList}>
                        {extracted.equipment.map((item, index) => (
                          <RNView 
                            key={index} 
                            style={[styles.equipmentItem, { backgroundColor: colors.backgroundSecondary }]}
                          >
                            <Text style={[styles.equipmentText, { color: colors.text }]}>
                              🔧 {item}
                            </Text>
                          </RNView>
                        ))}
                      </RNView>
                    </RNView>
                  )}
                </>
              )}
            </RNView>
          </RNView>
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.md,
  },
  errorEmoji: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  errorTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.md,
  },
  linkText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerButton: {
    padding: spacing.xs,
  },
  heroImage: {
    width: '100%',
    height: 250,
  },
  placeholderHero: {
    width: '100%',
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: spacing.lg,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    lineHeight: 34,
    marginBottom: spacing.md,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  metaIcon: {
    fontSize: 16,
  },
  metaValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  metaLabel: {
    fontSize: fontSize.sm,
  },
  qualityBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  qualityText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  tagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  sourceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  sourceButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    flex: 1,
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    marginBottom: spacing.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: {
    fontSize: fontSize.md,
  },
  tabTextActive: {
    fontWeight: fontWeight.semibold,
  },
  tabContent: {
    minHeight: 200,
  },
  componentSection: {
    marginBottom: spacing.lg,
  },
  componentTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.md,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
    marginRight: spacing.md,
  },
  ingredientContent: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  ingredientText: {
    flex: 1,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  ingredientQty: {
    fontWeight: fontWeight.semibold,
  },
  ingredientNotes: {
    fontStyle: 'italic',
  },
  ingredientCost: {
    fontSize: fontSize.sm,
    marginLeft: spacing.sm,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  stepNumberText: {
    color: '#FFFFFF',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  stepText: {
    flex: 1,
    fontSize: fontSize.md,
    lineHeight: 24,
  },
  nutritionSection: {
    marginBottom: spacing.xl,
  },
  nutritionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.md,
  },
  nutritionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  nutritionItem: {
    width: '48%',
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  nutritionValue: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
  },
  nutritionLabel: {
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  equipmentSection: {
    marginTop: spacing.md,
  },
  equipmentList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  equipmentItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  equipmentText: {
    fontSize: fontSize.sm,
  },
});
