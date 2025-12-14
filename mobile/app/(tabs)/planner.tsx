/**
 * Meal Planner Screen
 * 
 * Shows a weekly meal plan with breakfast, lunch, dinner, and snack slots.
 * Users can add recipes to slots, navigate between weeks, and add all
 * ingredients to their grocery list.
 */

import { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  View as RNView,
  RefreshControl,
  Alert,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/clerk-expo';

import { View, Text, Button, useColors } from '@/components/Themed';
import { SignInBanner } from '@/components/SignInBanner';
import { AnimatedListItem, ScalePressable } from '@/components/Animated';
import RecipePickerModal from '@/components/RecipePickerModal';
import {
  useMealPlanWeek,
  useAddMeal,
  useDeleteMeal,
  useAddPlanToGrocery,
  formatDateForApi,
  getWeekStart,
  getWeekEnd,
  formatDayLabel,
  formatFullDayLabel,
  isToday,
  parseDateFromApi,
} from '@/hooks/useMealPlan';
import { MealPlanEntry, MealType, RecipeListItem } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { haptics, lightHaptic, successHaptic } from '@/utils/haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DAY_WIDTH = (SCREEN_WIDTH - spacing.lg * 2 - spacing.sm * 6) / 7;

const MEAL_TYPES: { type: MealType; emoji: string; label: string }[] = [
  { type: 'breakfast', emoji: '🌅', label: 'Breakfast' },
  { type: 'lunch', emoji: '🌞', label: 'Lunch' },
  { type: 'dinner', emoji: '🌙', label: 'Dinner' },
  { type: 'snack', emoji: '🍿', label: 'Snack' },
];

// Day selector pill component
function DayPill({
  date,
  isSelected,
  colors,
  onPress,
}: {
  date: Date;
  isSelected: boolean;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  const label = formatDayLabel(date);
  const today = isToday(date);

  return (
    <TouchableOpacity
      style={[
        styles.dayPill,
        {
          backgroundColor: isSelected ? colors.tint : colors.card,
          borderColor: today ? colors.tint : colors.cardBorder,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.dayPillLabel,
          { color: isSelected ? '#FFFFFF' : colors.textMuted },
        ]}
      >
        {label.day}
      </Text>
      <Text
        style={[
          styles.dayPillNumber,
          { color: isSelected ? '#FFFFFF' : colors.text },
        ]}
      >
        {label.number}
      </Text>
      {today && (
        <RNView
          style={[
            styles.todayDot,
            { backgroundColor: isSelected ? '#FFFFFF' : colors.tint },
          ]}
        />
      )}
    </TouchableOpacity>
  );
}

// Meal slot component (shows either a recipe or "Add" button)
function MealSlot({
  mealType,
  entries,
  colors,
  onAdd,
  onRemove,
  onViewRecipe,
}: {
  mealType: { type: MealType; emoji: string; label: string };
  entries: MealPlanEntry[];
  colors: ReturnType<typeof useColors>;
  onAdd: () => void;
  onRemove: (entryId: string) => void;
  onViewRecipe: (recipeId: string) => void;
}) {
  return (
    <RNView style={styles.mealSlot}>
      <RNView style={styles.mealSlotHeader}>
        <Text style={styles.mealEmoji}>{mealType.emoji}</Text>
        <Text style={[styles.mealLabel, { color: colors.text }]}>
          {mealType.label}
        </Text>
      </RNView>

      {entries.length === 0 ? (
        <TouchableOpacity
          style={[
            styles.addMealButton,
            { backgroundColor: colors.card, borderColor: colors.cardBorder },
          ]}
          onPress={onAdd}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={20} color={colors.tint} />
          <Text style={[styles.addMealText, { color: colors.tint }]}>
            Add {mealType.label.toLowerCase()}
          </Text>
        </TouchableOpacity>
      ) : (
        <RNView style={styles.mealEntries}>
          {entries.map((entry) => (
            <ScalePressable
              key={entry.id}
              style={[
                styles.mealCard,
                { backgroundColor: colors.card, borderColor: colors.cardBorder },
              ]}
              onPress={() => onViewRecipe(entry.recipe_id)}
              scaleValue={0.98}
            >
              {entry.recipe_thumbnail ? (
                <Image
                  source={{ uri: entry.recipe_thumbnail }}
                  style={styles.mealThumbnail}
                />
              ) : (
                <RNView
                  style={[
                    styles.mealThumbnailPlaceholder,
                    { backgroundColor: colors.tint + '15' },
                  ]}
                >
                  <Ionicons name="restaurant-outline" size={16} color={colors.tint} />
                </RNView>
              )}
              <RNView style={styles.mealCardContent}>
                <Text
                  style={[styles.mealCardTitle, { color: colors.text }]}
                  numberOfLines={2}
                >
                  {entry.recipe_title}
                </Text>
                {entry.notes && (
                  <Text
                    style={[styles.mealCardNotes, { color: colors.textMuted }]}
                    numberOfLines={1}
                  >
                    {entry.notes}
                  </Text>
                )}
              </RNView>
              <TouchableOpacity
                style={styles.removeMealButton}
                onPress={() => onRemove(entry.id)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close-circle" size={20} color={colors.error} />
              </TouchableOpacity>
            </ScalePressable>
          ))}
          {/* Add another button */}
          <TouchableOpacity
            style={[
              styles.addAnotherButton,
              { borderColor: colors.cardBorder },
            ]}
            onPress={onAdd}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={16} color={colors.tint} />
          </TouchableOpacity>
        </RNView>
      )}
    </RNView>
  );
}

export default function PlannerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isSignedIn, isLoaded } = useAuth();

  // Current week and selected day
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getWeekStart(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  // Modal state
  const [pickerVisible, setPickerVisible] = useState(false);
  const [selectedMealType, setSelectedMealType] = useState<MealType>('dinner');

  // Fetch week data
  const weekOfStr = formatDateForApi(currentWeekStart);
  const { data: weekPlan, isLoading, refetch, isRefetching } = useMealPlanWeek(weekOfStr);

  // Mutations
  const addMeal = useAddMeal();
  const deleteMeal = useDeleteMeal();
  const addToGrocery = useAddPlanToGrocery();

  // Refetch when tab gains focus (handles cache cleared on user change)
  useFocusEffect(
    useCallback(() => {
      if (isSignedIn) {
        refetch();
      }
    }, [isSignedIn, refetch])
  );

  // Get week dates for the day strip
  const weekDates = useMemo(() => {
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      dates.push(
        new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), currentWeekStart.getDate() + i)
      );
    }
    return dates;
  }, [currentWeekStart]);

  // Get meals for the selected day
  const selectedDayMeals = useMemo(() => {
    if (!weekPlan) return null;
    const dateStr = formatDateForApi(selectedDate);
    return weekPlan.days.find((d) => d.date === dateStr) || null;
  }, [weekPlan, selectedDate]);

  // Navigate between weeks
  const goToPrevWeek = useCallback(() => {
    lightHaptic();
    const newStart = new Date(
      currentWeekStart.getFullYear(),
      currentWeekStart.getMonth(),
      currentWeekStart.getDate() - 7
    );
    setCurrentWeekStart(newStart);
    setSelectedDate(newStart);
  }, [currentWeekStart]);

  const goToNextWeek = useCallback(() => {
    lightHaptic();
    const newStart = new Date(
      currentWeekStart.getFullYear(),
      currentWeekStart.getMonth(),
      currentWeekStart.getDate() + 7
    );
    setCurrentWeekStart(newStart);
    setSelectedDate(newStart);
  }, [currentWeekStart]);

  const goToToday = useCallback(() => {
    lightHaptic();
    const today = new Date();
    setCurrentWeekStart(getWeekStart(today));
    setSelectedDate(today);
  }, []);

  // Handle adding a meal
  const handleAddMeal = useCallback((mealType: MealType) => {
    lightHaptic();
    setSelectedMealType(mealType);
    setPickerVisible(true);
  }, []);

  // Handle recipe selection from picker
  const handleRecipeSelected = useCallback(
    async (recipe: RecipeListItem) => {
      setPickerVisible(false);
      try {
        await addMeal.mutateAsync({
          date: formatDateForApi(selectedDate),
          meal_type: selectedMealType,
          recipe_id: recipe.id,
          recipe_title: recipe.title,
          recipe_thumbnail: recipe.thumbnail_url,
        });
        successHaptic();
      } catch {
        // User-facing alert is sufficient
        Alert.alert('Error', 'Failed to add recipe to meal plan');
      }
    },
    [addMeal, selectedDate, selectedMealType]
  );

  // Handle removing a meal
  const handleRemoveMeal = useCallback(
    (entryId: string) => {
      Alert.alert('Remove Meal', 'Are you sure you want to remove this from your plan?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMeal.mutateAsync(entryId);
              successHaptic();
            } catch {
              // Silent fail - optimistic update already reverted
            }
          },
        },
      ]);
    },
    [deleteMeal]
  );

  // Handle adding to grocery
  const handleAddToGrocery = useCallback(async () => {
    lightHaptic();
    try {
      const result = await addToGrocery.mutateAsync({
        startDate: formatDateForApi(currentWeekStart),
        endDate: formatDateForApi(
          new Date(
            currentWeekStart.getFullYear(),
            currentWeekStart.getMonth(),
            currentWeekStart.getDate() + 6
          )
        ),
      });
      successHaptic();
      Alert.alert(
        'Added to Grocery List',
        `Added ${result.items_added} ingredients from your meal plan.`,
        [
          { text: 'OK' },
          {
            text: 'View List',
            onPress: () => router.push('/(tabs)/grocery'),
          },
        ]
      );
    } catch {
      // User-facing alert is sufficient
      Alert.alert('Error', 'Failed to add ingredients to grocery list');
    }
  }, [addToGrocery, currentWeekStart, router]);

  // View recipe detail
  const handleViewRecipe = useCallback(
    (recipeId: string) => {
      router.push(`/recipe/${recipeId}`);
    },
    [router]
  );

  // Format week range for header
  const weekRangeLabel = useMemo(() => {
    const end = new Date(
      currentWeekStart.getFullYear(),
      currentWeekStart.getMonth(),
      currentWeekStart.getDate() + 6
    );
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (currentWeekStart.getMonth() === end.getMonth()) {
      return `${months[currentWeekStart.getMonth()]} ${currentWeekStart.getDate()}-${end.getDate()}`;
    }
    return `${months[currentWeekStart.getMonth()]} ${currentWeekStart.getDate()} - ${months[end.getMonth()]} ${end.getDate()}`;
  }, [currentWeekStart]);

  // Auth check
  if (isLoaded && !isSignedIn) {
    return (
      <View style={styles.container}>
        <SignInBanner message="Sign in to plan your meals for the week!" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Week Navigation Header */}
      <RNView style={[styles.weekHeader, { backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={goToPrevWeek} style={styles.weekNavButton}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>

        <TouchableOpacity onPress={goToToday} style={styles.weekLabelContainer}>
          <Text style={[styles.weekLabel, { color: colors.text }]}>
            {weekRangeLabel}
          </Text>
          <RNView style={[styles.todayButton, { backgroundColor: colors.tint + '15' }]}>
            <Text style={[styles.todayButtonText, { color: colors.tint }]}>Today</Text>
          </RNView>
        </TouchableOpacity>

        <TouchableOpacity onPress={goToNextWeek} style={styles.weekNavButton}>
          <Ionicons name="chevron-forward" size={24} color={colors.text} />
        </TouchableOpacity>
      </RNView>

      {/* Day Strip */}
      <RNView style={[styles.dayStrip, { borderBottomColor: colors.border }]}>
        {weekDates.map((date, index) => (
          <DayPill
            key={index}
            date={date}
            isSelected={formatDateForApi(date) === formatDateForApi(selectedDate)}
            colors={colors}
            onPress={() => {
              lightHaptic();
              setSelectedDate(date);
            }}
          />
        ))}
      </RNView>

      {/* Day Content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.tint}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Day Header */}
        <Text style={[styles.dayTitle, { color: colors.text }]}>
          {formatFullDayLabel(selectedDate)}
        </Text>

        {isLoading ? (
          <RNView style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.tint} />
            <Text style={[styles.loadingText, { color: colors.textMuted }]}>
              Loading meal plan...
            </Text>
          </RNView>
        ) : (
          <>
            {/* Meal Slots */}
            {MEAL_TYPES.map((mealType) => (
              <MealSlot
                key={mealType.type}
                mealType={mealType}
                entries={
                  selectedDayMeals
                    ? selectedDayMeals[mealType.type] || []
                    : []
                }
                colors={colors}
                onAdd={() => handleAddMeal(mealType.type)}
                onRemove={handleRemoveMeal}
                onViewRecipe={handleViewRecipe}
              />
            ))}

            {/* Add to Grocery Button */}
            <TouchableOpacity
              style={[
                styles.groceryButton,
                { backgroundColor: colors.success },
              ]}
              onPress={handleAddToGrocery}
              disabled={addToGrocery.isPending}
              activeOpacity={0.8}
            >
              {addToGrocery.isPending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="cart-outline" size={20} color="#FFFFFF" />
                  <Text style={styles.groceryButtonText}>
                    Add Week to Grocery List
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* Recipe Picker Modal */}
      <RecipePickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handleRecipeSelected}
        title={`Add ${selectedMealType}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  weekNavButton: {
    padding: spacing.xs,
  },
  weekLabelContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  weekLabel: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  todayButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: radius.sm,
  },
  todayButtonText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  dayStrip: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
  },
  dayPill: {
    alignItems: 'center',
    justifyContent: 'center',
    width: DAY_WIDTH,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  dayPillLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  dayPillNumber: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    marginTop: 2,
  },
  todayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 4,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  dayTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.lg,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.md,
  },
  mealSlot: {
    marginBottom: spacing.lg,
  },
  mealSlotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  mealEmoji: {
    fontSize: 20,
    marginRight: spacing.xs,
  },
  mealLabel: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  addMealButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: spacing.xs,
  },
  addMealText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  mealEntries: {
    gap: spacing.sm,
  },
  mealCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  mealThumbnail: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
  },
  mealThumbnailPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealCardContent: {
    flex: 1,
    marginLeft: spacing.sm,
    marginRight: spacing.sm,
  },
  mealCardTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  mealCardNotes: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  removeMealButton: {
    padding: spacing.xs,
  },
  addAnotherButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  groceryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  groceryButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});

