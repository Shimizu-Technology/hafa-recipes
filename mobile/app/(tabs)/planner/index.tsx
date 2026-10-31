import { useRecipeOwnerGeneration } from '@/hooks/useOfflineLease';
import { api } from '@/lib/api';
import * as Crypto from 'expo-crypto';
import { useQuery } from '@tanstack/react-query';
/**
 * Meal Planner Screen
 *
 * Shows a weekly meal plan with breakfast, lunch, dinner, and snack slots.
 * Users can add recipes to slots, navigate between weeks, and add all
 * ingredients to their grocery list.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  View as RNView,
  RefreshControl,
  Alert,
  Dimensions,
  useWindowDimensions,
  ActivityIndicator,
  Modal,
  TextInput,
  ActionSheetIOS,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/expo';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

import { IconButton, View, Text, Button, useColors } from '@/components/Themed';
import { SignInBanner } from '@/components/SignInBanner';
import { AnimatedListItem, ScalePressable } from '@/components/Animated';
import RecipePickerModal from '@/components/RecipePickerModal';
import { PlannerRecipeHandoffCard } from '@/components/PlannerRecipeHandoffCard';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import {
  useMealPlanWeek,
  useAddMeal,
  mealPlanKeys,
  useUpdateMeal,
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
import { useRecipe } from '@/hooks/useRecipes';
import { spacing, fontSize, fontWeight, radius, fontFamily } from '@/constants/Colors';
import { haptics, lightHaptic, successHaptic } from '@/utils/haptics';
import { showToast } from '@/lib/toast';
import {
  buildMealPlanEntry,
  parsePlannerDateParam,
  parsePlannerRecipeParam,
  plannerGrocerySuccessMessage,
  type MealPlanRecipe,
} from '@/lib/plannerNavigation';
import { appRoutes } from '@/lib/routes';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DAY_WIDTH = (SCREEN_WIDTH - spacing.lg * 2 - spacing.sm * 6) / 7;

type MealTypeMeta = { type: MealType; icon: keyof typeof Ionicons.glyphMap; label: string };

const MEAL_TYPES: MealTypeMeta[] = [
  { type: 'breakfast', icon: 'sunny-outline', label: 'Breakfast' },
  { type: 'lunch', icon: 'cafe-outline', label: 'Lunch' },
  { type: 'dinner', icon: 'restaurant-outline', label: 'Dinner' },
  { type: 'snack', icon: 'nutrition-outline', label: 'Snack' },
];

const PLANNER_PREVIEW_MEALS: Array<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  title: string;
  detail: string;
}> = [
  {
    icon: 'sunny-outline',
    label: 'Breakfast',
    title: 'Fresh fruit bowl',
    detail: 'Light start before the day gets busy',
  },
  {
    icon: 'cafe-outline',
    label: 'Lunch',
    title: 'Tinaktak rice bowl',
    detail: 'Save a family favorite into the week',
  },
  {
    icon: 'restaurant-outline',
    label: 'Dinner',
    title: 'Sheet-pan chicken',
    detail: 'Send ingredients straight to groceries',
  },
];

// Day selector pill component
function DayPill({
  date,
  isSelected,
  colors,
  onPress,
  mealTitles,
}: {
  mealTitles?: string[];
  date: Date;
  isSelected: boolean;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  const label = formatDayLabel(date);
  const today = isToday(date);

  return (
    <ScalePressable
      style={[
        styles.dayPill,
        mealTitles && { width: 128 },
        {
          backgroundColor: isSelected ? colors.text : colors.card,
          borderColor: today ? colors.tint : colors.cardBorder,
        },
      ]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={`${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${today ? ', today' : ''}${mealTitles ? `, ${mealTitles.length} meals, ${mealTitles.join(', ')}` : ''}`}
      accessibilityState={{ selected: isSelected, checked: isSelected }}
    >
      <Text
        style={[
          styles.dayPillLabel,
          { color: isSelected ? colors.background : colors.textMuted },
        ]}
      >
        {label.day}
      </Text>
      <Text
        style={[
          styles.dayPillNumber,
          { color: isSelected ? colors.background : colors.text },
        ]}
      >
        {label.number}
      </Text>
      {mealTitles && <Text style={{ color: isSelected ? colors.background : colors.textMuted }} numberOfLines={2}>
        {mealTitles.length ? `${mealTitles.length} meals · ${mealTitles.join(' · ')}` : 'No meals'}
      </Text>}
      {today && (
        <RNView
          style={[
            styles.todayDot,
            { backgroundColor: isSelected ? colors.background : colors.tint },
          ]}
        />
      )}
    </ScalePressable>
  );
}

// Meal slot component (shows either a recipe or "Add" button)
/** Render one meal-plan slot and its assigned recipe, if present. */
export function MealSlot({
  mealType,
  entries,
  colors,
  onAdd,
  onRemove,
  onViewRecipe,
  onEditServings,
  pendingRecipeTitle,
  isAdding,
  isAddDisabled,
  entriesOnly = false,
}: {
  entriesOnly?: boolean;
  mealType: MealTypeMeta;
  entries: MealPlanEntry[];
  colors: ReturnType<typeof useColors>;
  onAdd: () => void;
  onRemove: (entryId: string) => void;
  onViewRecipe: (recipeId: string) => void;
  onEditServings?: (entry: MealPlanEntry) => void;
  pendingRecipeTitle?: string;
  isAdding: boolean;
  isAddDisabled: boolean;
}) {
  return (
    <RNView style={styles.mealSlot}>
      {!entriesOnly && entries.length > 0 && <RNView style={styles.mealSlotHeader}>
        <RNView style={[styles.mealIcon, { backgroundColor: colors.tint + '15' }]}>
          <Ionicons name={mealType.icon} size={18} color={colors.actionText} />
        </RNView>
        <Text style={[styles.mealLabel, { color: colors.text }]}>
          {mealType.label}
        </Text>
      </RNView>}

      {entries.length === 0 ? (entriesOnly ? null : (
        <TouchableOpacity
          style={[
            styles.addMealButton,
            { backgroundColor: 'transparent' },
          ]}
          onPress={onAdd}
          disabled={isAddDisabled}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={pendingRecipeTitle
            ? `Plan ${pendingRecipeTitle} for ${mealType.label}`
            : `Add ${mealType.label}`}
          accessibilityState={{ busy: isAdding, disabled: isAddDisabled }}
        >
          {isAdding ? (
            <>
              <ActivityIndicator size="small" color={colors.actionText} />
              <Text style={[styles.addMealText, { color: colors.actionText }]}>Adding...</Text>
            </>
          ) : (
            <>
              <Ionicons name={pendingRecipeTitle ? 'calendar-outline' : 'add'} size={20} color={colors.actionText} />
              <Text style={[styles.addMealText, { color: colors.actionText }]}>
                {pendingRecipeTitle ? 'Plan here' : `Add ${mealType.label.toLowerCase()}`}
              </Text>
            </>
          )}
        </TouchableOpacity>
      )) : (
        <RNView style={styles.mealEntries}>
          {entries.map((entry) => (
            <RNView
              key={entry.id}
              style={[
                styles.mealCard,
                { backgroundColor: 'transparent' },
              ]}
            >
              <TouchableOpacity onPress={() => onViewRecipe(entry.recipe_id)} accessible={false}>
              <RecipeThumbnail
                uri={entry.recipe_thumbnail}
                style={styles.mealThumbnail}
                accessibilityLabel={`${entry.recipe_title} photo`}
                placeholderIconSize={16}
              /></TouchableOpacity>
              <RNView style={styles.mealCardContent}>
                <ScalePressable onPress={() => onViewRecipe(entry.recipe_id)} style={{ minHeight: 44, justifyContent: 'center' }}
                  accessibilityRole="button" accessibilityLabel={`Open ${entry.recipe_title}`}>
                <Text
                  style={[styles.mealCardTitle, { color: colors.text }]}
                >
                  {entry.recipe_title}
                </Text></ScalePressable>
              <TouchableOpacity onPress={() => onEditServings?.(entry)} style={{ minHeight: 44, justifyContent: 'center' }}
                accessibilityRole="button" accessibilityLabel={`Edit servings for ${entry.recipe_title}`}>
                <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18 }}>{entry.planned_servings ? `${entry.planned_servings} servings` : entry.servings || 'Recipe servings'} · {mealType.label}</Text>
              </TouchableOpacity>
                {entry.notes && (
                  <Text
                    style={[styles.mealCardNotes, { color: colors.textMuted }]}
                    numberOfLines={1}
                  >
                    {entry.notes}
                  </Text>
                )}
              </RNView>

              <IconButton
                icon="close-circle-outline"
                accessibilityLabel={`Remove ${entry.recipe_title || 'recipe'} from ${mealType.label}`}
                onPress={() => onRemove(entry.id)}
              />
            </RNView>
          ))}
          {!entriesOnly && (pendingRecipeTitle ? (
            <TouchableOpacity
              style={[styles.planHereButton, { borderColor: colors.tint }]}
              onPress={onAdd}
              disabled={isAddDisabled}
              accessibilityRole="button"
              accessibilityLabel={`Plan ${pendingRecipeTitle} for ${mealType.label}`}
              accessibilityState={{ busy: isAdding, disabled: isAddDisabled }}
            >
              {isAdding ? (
                <ActivityIndicator size="small" color={colors.actionText} />
              ) : (
                <Ionicons name="calendar-outline" size={16} color={colors.actionText} />
              )}
              <Text style={[styles.planHereText, { color: colors.actionText }]}>
                {isAdding ? 'Adding...' : 'Plan here'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.addAnotherButton, { borderColor: colors.cardBorder }]}
              onPress={onAdd}
              disabled={isAddDisabled}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Add another ${mealType.label}`}
              accessibilityState={{ disabled: isAddDisabled }}
            >
              <Ionicons name="add" size={16} color={colors.actionText} /><Text style={{ color: colors.actionText }}>Add</Text>
            </TouchableOpacity>
          ))}
        </RNView>
      )}
    </RNView>
  );
}

export default function PlannerScreen() {
  const generation = useRecipeOwnerGeneration();
  return <PlannerScreenContent key={generation} />;
}

function PlannerScreenContent() {
  const { fontScale } = useWindowDimensions();
  const [mealTypeDate, setMealTypeDate] = useState<Date | null>(null);
  const headerHeight = useHeaderHeight();
  const router = useRouter();
  const {
    date: requestedDateParam,
    recipeId: requestedRecipeParam,
    servings: requestedServings,
  } = useLocalSearchParams<{
    date?: string | string[];
    recipeId?: string | string[];
    servings?: string;
  }>();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isSignedIn, isLoaded, userId, sessionId } = useAuth();

  const weekScroll = useRef<ScrollView>(null);
  const dayPositions = useRef<Record<string, number>>({});
  const pendingScrollDate = useRef<string | null>(null);
  const scrollToRequestedDay = () => {
    if (!weekPlan || isLoading) return;
    const date = pendingScrollDate.current;
    if (date && dayPositions.current[date] !== undefined) {
      // Automatic insets allow negative offsets while the large native title is expanded.
      weekScroll.current?.scrollTo({ y: dayPositions.current[date] - headerHeight, animated: false });
    }
  };

  // Current week and selected day
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getWeekStart(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  // Modal state
  const [pickerVisible, setPickerVisible] = useState(false);
  const [selectedMealType, setSelectedMealType] = useState<MealType>('dinner');
  const [addingMealType, setAddingMealType] = useState<MealType | null>(null);

  const requestedRecipeId = useMemo(
    () => parsePlannerRecipeParam(
      Array.isArray(requestedRecipeParam) ? requestedRecipeParam[0] : requestedRecipeParam,
    ),
    [requestedRecipeParam],
  );
  const {
    data: requestedRecipe,
    isLoading: isRequestedRecipeLoading,
    isError: isRequestedRecipeError,
    isRefetching: isRequestedRecipeRetrying,
    refetch: refetchRequestedRecipe,
  } = useRecipe(requestedRecipeId ?? '', isSignedIn === true && !!requestedRecipeId);
  const handoffRecipe = useMemo<MealPlanRecipe | null>(() => {
    if (!requestedRecipe) return null;
    return {
      id: requestedRecipe.id,
      title: requestedRecipe.extracted.title || 'Untitled recipe',
      thumbnail_url: requestedRecipe.thumbnail_url,
      review_state: requestedRecipe.review_state,
      servings: Number.isInteger(Number(requestedServings)) && Number(requestedServings) > 0 ? Number(requestedServings) : requestedRecipe.extracted.servings,
    };
  }, [requestedRecipe, requestedServings]);
  const requestedRecipeHasBlockingError = isRequestedRecipeError && !handoffRecipe;
  const requestedRecipeHandoffIsLoading = !!requestedRecipeId
    && (!isLoaded || isRequestedRecipeLoading);
  const requestedRecipeIsPending = !!requestedRecipeId
    && !handoffRecipe
    && (!isLoaded || isRequestedRecipeLoading || isRequestedRecipeRetrying);

  useEffect(() => {
    const requestedDate = parsePlannerDateParam(
      Array.isArray(requestedDateParam) ? requestedDateParam[0] : requestedDateParam,
    );
    if (!requestedDate) return;

    const requestedWeek = getWeekStart(requestedDate);
    const sameWeek = formatDateForApi(requestedWeek) === formatDateForApi(currentWeekStart);
    if (!sameWeek) dayPositions.current = {};
    pendingScrollDate.current = formatDateForApi(requestedDate);
    if (sameWeek) scrollToRequestedDay();
    else setCurrentWeekStart(requestedWeek);
    setSelectedDate(requestedDate);
  }, [requestedDateParam]);

  // Fetch week data
  const weekOfStr = formatDateForApi(currentWeekStart);
  const { data: weekPlan, isLoading, isError, isFetching, refetch } = useMealPlanWeek(
    weekOfStr, isLoaded && isSignedIn === true,
  );
  const { isPullRefreshing, onPullRefresh } = usePullToRefresh(refetch);

  // Native-stack reports the expanded header after the first content layout.
  // Keep the requested heading aligned through that update; a drag ends the handoff.
  useEffect(() => { scrollToRequestedDay(); }, [headerHeight, weekPlan, isLoading]);

  // Mutations
  const addMeal = useAddMeal();
  const updateMeal = useUpdateMeal();
  const [editingServings, setEditingServings] = useState<MealPlanEntry | null>(null);
  const [servingsInput, setServingsInput] = useState('');
  const [reviewVisible, setReviewVisible] = useState(false);
  const [reviewMutationId, setReviewMutationId] = useState('');
  const [reviewAdding, setReviewAdding] = useState(false);
  const pendingReview = useRef<Parameters<ReturnType<typeof useAddPlanToGrocery>['mutateAsync']>[0] | null>(null);
  const reviewAccount = `${userId ?? ''}:${sessionId ?? ''}`;
  const reviewOwner = useRef(reviewAccount);
  if (reviewOwner.current !== reviewAccount) { pendingReview.current = null; reviewOwner.current = reviewAccount; }
  const review = useQuery({ queryKey: [...mealPlanKeys.review(weekOfStr), reviewAccount],
    queryFn: () => api.previewMealPlanGroceries(weekOfStr, formatDateForApi(getWeekEnd(currentWeekStart))),
    enabled: reviewVisible && isSignedIn === true,
  });
  useEffect(() => { setReviewVisible(false); setReviewAdding(false); }, [reviewAccount]);
  const reviewData = pendingReview.current?.review?.review ?? review.data;
  const deleteMeal = useDeleteMeal();
  const addToGrocery = useAddPlanToGrocery();


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
    pendingScrollDate.current = null;
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
    const target = formatDateForApi(today);
    if (formatDateForApi(getWeekStart(today)) === weekOfStr && dayPositions.current[target] !== undefined) {
      pendingScrollDate.current = target;
      weekScroll.current?.scrollTo({ y: dayPositions.current[target] - headerHeight, animated: false });
    } else {
      dayPositions.current = {};
      pendingScrollDate.current = target;
    }
    setCurrentWeekStart(getWeekStart(today));
    setSelectedDate(today);
  }, [weekOfStr, headerHeight]);

  const addRecipeToMeal = useCallback(
    async (recipe: MealPlanRecipe, mealType: MealType, date = selectedDate) => {
      setAddingMealType(mealType);
      try {
        await addMeal.mutateAsync(buildMealPlanEntry(
          recipe,
          formatDateForApi(date),
          mealType,
        ));
        successHaptic();
        if (requestedRecipeId) {
          router.replace(appRoutes.plannerDate(formatDateForApi(date)));
        }
      } catch {
        // User-facing alert is sufficient
        Alert.alert('Couldn’t add to meal plan', 'This recipe wasn’t added. Please try again.');
      } finally {
        setAddingMealType(null);
      }
    },
    [addMeal, requestedRecipeId, router, selectedDate],
  );

  // Add the handed-off recipe directly, or open the normal recipe picker.
  const handleAddMeal = useCallback((mealType: MealType, date = selectedDate) => {
    setSelectedDate(date);
    lightHaptic();
    if (handoffRecipe) {
      void addRecipeToMeal(handoffRecipe, mealType, date);
      return;
    }
    setSelectedMealType(mealType);
    setPickerVisible(true);
  }, [addRecipeToMeal, handoffRecipe, selectedDate]);

  // Handle recipe selection from picker
  const handleRecipeSelected = useCallback(
    (recipe: RecipeListItem) => {
      setPickerVisible(false);
      void addRecipeToMeal(recipe, selectedMealType);
    },
    [addRecipeToMeal, selectedMealType],
  );

  const dismissRequestedRecipe = useCallback(() => {
    router.replace(appRoutes.plannerDate(formatDateForApi(selectedDate)));
  }, [router, selectedDate]);

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
  const handleAddToGrocery = () => { if (!pendingReview.current) setReviewMutationId(Crypto.randomUUID()); setReviewVisible(true); };
  const confirmGroceries = async () => {
    if (!reviewData || reviewAdding) return;
    setReviewAdding(true);
    const owner = reviewAccount;
    try {
      pendingReview.current ??= { startDate: weekOfStr, endDate: formatDateForApi(getWeekEnd(currentWeekStart)), review: {
        preview_token: reviewData.preview_token, mutation_id: reviewMutationId, list_id: reviewData.list_id, review: reviewData,
      } };
      const result = await addToGrocery.mutateAsync(pendingReview.current);
      if (reviewOwner.current !== owner) return;
      pendingReview.current = null;
      setReviewVisible(false); successHaptic();
      showToast({ message: plannerGrocerySuccessMessage(result), tone: 'success', actionLabel: 'View list', onAction: () => router.push('/(tabs)/grocery') });
    } catch (error: any) {
      if (reviewOwner.current !== owner) return;
      if (error?.response?.status === 409) Alert.alert('Review needed', error.response.data?.detail ?? 'Your plan or household changed.', [
        { text: 'Keep previous request', style: 'cancel' },
        { text: 'Review current list', onPress: () => { pendingReview.current = null; setReviewMutationId(Crypto.randomUUID()); void review.refetch(); } },
      ]);
      else Alert.alert('Couldn’t confirm groceries', 'Retry this addition to reconnect to the same request. Your previous review is kept when you close this screen.');
    }
    finally { if (reviewOwner.current === owner) setReviewAdding(false); }
  };

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
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={styles.signedOutScroll}
          contentContainerStyle={[
            styles.signedOutContent,
            {
              paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl,
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <RNView
            style={[
              styles.signedOutHero,
              { backgroundColor: colors.backgroundElevated, borderColor: colors.cardBorder },
            ]}
          >
            <RNView style={[styles.signedOutHeroIcon, { backgroundColor: colors.tint + '15' }]}>
              <Ionicons name="calendar-outline" size={30} color={colors.actionText} />
            </RNView>
            <Text style={[styles.signedOutEyebrow, { color: colors.actionText }]}>Meal planning preview</Text>
            <Text style={[styles.signedOutTitle, { color: colors.text }]}>Plan the week before dinner feels urgent.</Text>
            <Text style={[styles.signedOutSubtitle, { color: colors.textSecondary }]}>
              Sign in to map recipes across breakfast, lunch, dinner, and snacks — then send the whole week to your grocery list.
            </Text>
          </RNView>

          <RNView
            style={[
              styles.previewPlannerCard,
              { backgroundColor: 'transparent' },
            ]}
          >
            <RNView style={styles.previewPlannerHeader}>
              <RNView>
                <Text style={[styles.previewPlannerKicker, { color: colors.textMuted }]}>This week</Text>
                <Text style={[styles.previewPlannerTitle, { color: colors.text }]}>A calmer meal board</Text>
              </RNView>
              <RNView style={[styles.previewTodayBadge, { backgroundColor: colors.tint + '15' }]}>
                <Text style={[styles.previewTodayText, { color: colors.actionText }]}>Today</Text>
              </RNView>
            </RNView>

            <RNView style={styles.previewDayRow}>
              {weekDates.map((date) => {
                const label = formatDayLabel(date);
                const today = isToday(date);
                return (
                  <RNView
                    key={date.toISOString()}
                    style={[
                      styles.previewDayPill,
                      {
                        backgroundColor: today ? colors.tint : colors.backgroundSecondary,
                        borderColor: today ? colors.tint : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.previewDayText, { color: today ? colors.onTint : colors.textMuted }]}>
                      {label.day}
                    </Text>
                    <Text style={[styles.previewDayNumber, { color: today ? colors.onTint : colors.text }]}>
                      {label.number}
                    </Text>
                  </RNView>
                );
              })}
            </RNView>

            <RNView style={styles.previewMealStack}>
              {PLANNER_PREVIEW_MEALS.map((meal) => (
                <RNView
                  key={meal.label}
                  style={[
                    styles.previewMealRow,
                    { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
                  ]}
                >
                  <RNView style={[styles.previewMealIcon, { backgroundColor: colors.tint + '15' }]}>
                    <Ionicons name={meal.icon} size={18} color={colors.actionText} />
                  </RNView>
                  <RNView style={styles.previewMealCopy}>
                    <Text style={[styles.previewMealLabel, { color: colors.textMuted }]}>{meal.label}</Text>
                    <Text style={[styles.previewMealTitle, { color: colors.text }]}>{meal.title}</Text>
                    <Text style={[styles.previewMealDetail, { color: colors.textSecondary }]}>{meal.detail}</Text>
                  </RNView>
                </RNView>
              ))}
            </RNView>

            <RNView style={[styles.previewGroceryCallout, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name="cart-outline" size={20} color={colors.accent} />
              <Text style={[styles.previewGroceryText, { color: colors.text }]}>
                Add every planned recipe to groceries in one tap after you sign in.
              </Text>
            </RNView>
          </RNView>
        </ScrollView>
        <SignInBanner message="Sign in to plan your meals for the week!" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.groupedBackground }]}>
      {/* Day Content */}
      <ScrollView ref={weekScroll} onContentSizeChange={scrollToRequestedDay}
          onScrollBeginDrag={() => { pendingScrollDate.current = null; }}
          contentInsetAdjustmentBehavior="automatic"
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={isPullRefreshing}
            onRefresh={onPullRefresh}
            tintColor={colors.tint}
          />
        }
        showsVerticalScrollIndicator={false}
      >
      {/* Week Navigation Header */}
      <RNView style={styles.weekHeader}>
        <TouchableOpacity onPress={goToPrevWeek} accessibilityRole="button" accessibilityLabel="Previous week" style={styles.weekNavButton}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>

        <TouchableOpacity onPress={goToToday} accessibilityRole="button" accessibilityLabel="Go to today" style={[styles.weekLabelContainer, fontScale >= 1.3 && { flexDirection: 'column' }]}>
          <Text style={[styles.weekLabel, { color: colors.text }]}>
            {weekRangeLabel}
          </Text>
          <RNView style={styles.todayButton}>
            <Text style={[styles.todayButtonText, { color: colors.actionText }]}>Today</Text>
          </RNView>
        </TouchableOpacity>

        <TouchableOpacity onPress={goToNextWeek} accessibilityRole="button" accessibilityLabel="Next week" style={styles.weekNavButton}>
          <Ionicons name="chevron-forward" size={24} color={colors.text} />
        </TouchableOpacity>
      </RNView>

        {requestedRecipeId && (
          <PlannerRecipeHandoffCard
            title={handoffRecipe?.title}
            thumbnailUrl={handoffRecipe?.thumbnail_url}
            reviewState={handoffRecipe?.review_state}
            isLoading={requestedRecipeHandoffIsLoading}
            hasError={requestedRecipeHasBlockingError}
            isRetrying={isRequestedRecipeRetrying}
            onRetry={() => { void refetchRequestedRecipe(); }}
            onDismiss={dismissRequestedRecipe}
          />
        )}

        {isError && (
          <RNView style={styles.loadingContainer} accessibilityRole="alert">
            <Text style={[styles.loadingText, { color: colors.text }]}>
              {weekPlan ? 'Couldn’t refresh your meal plan' : 'Couldn’t load your meal plan'}
            </Text>
            <Text style={[styles.loadingText, { color: colors.textMuted }]}>
              {weekPlan ? 'Your last loaded meals are still shown below.' : 'Check your connection and try again.'}
            </Text>
            <Button title={isFetching ? 'Trying again…' : 'Try again'}
              disabled={isFetching} onPress={() => { void refetch(); }} />
          </RNView>
        )}
        {(isLoading || !isLoaded) && !weekPlan ? (
          <RNView style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.actionText} />
            <Text style={[styles.loadingText, { color: colors.textMuted }]}>
              Loading meal plan...
            </Text>
          </RNView>
        ) : !weekPlan && isError ? null : (
          <>
            {weekDates.map(date => {
              const day = weekPlan?.days.find(value => value.date === formatDateForApi(date));
              return <RNView key={formatDateForApi(date)} style={{ marginBottom: 24 }} onLayout={event => { dayPositions.current[formatDateForApi(date)] = event.nativeEvent.layout.y; scrollToRequestedDay(); }}>
                <Text accessibilityRole="header" style={[styles.dayTitle, { color: colors.text }]}>{formatFullDayLabel(date)}</Text>
                <RNView style={{ backgroundColor: colors.backgroundElevated, borderRadius: 12, paddingHorizontal: 12 }}>
                  {MEAL_TYPES.map(mealType => <MealSlot entriesOnly key={mealType.type} mealType={mealType}
                    entries={day?.[mealType.type] || []} colors={colors}
                    onAdd={() => handleAddMeal(mealType.type, date)} onRemove={handleRemoveMeal} onViewRecipe={handleViewRecipe}
                    onEditServings={entry => { setEditingServings(entry); setServingsInput(String(entry.planned_servings ?? entry.servings ?? '')); }}
                    pendingRecipeTitle={handoffRecipe?.title}
                    isAdding={addingMealType === mealType.type && formatDateForApi(date) === formatDateForApi(selectedDate)}
                    isAddDisabled={addMeal.isPending || requestedRecipeIsPending} />)}
                  <TouchableOpacity style={styles.addMealButton} accessibilityRole="button" accessibilityLabel={`Add meal for ${formatFullDayLabel(date)}`}
                    disabled={addMeal.isPending || requestedRecipeIsPending} onPress={() => {
                      const actions = MEAL_TYPES.map(meal => ({ text: meal.label, onPress: () => handleAddMeal(meal.type, date) }));
                      if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ title: 'Meal type', options: [...actions.map(action => action.text), 'Cancel'], cancelButtonIndex: actions.length }, index => actions[index]?.onPress());
                      else setMealTypeDate(date);
                    }}><Ionicons name="add" size={20} color={colors.actionText} /><Text style={{ color: colors.actionText, fontSize: 17, lineHeight: 22 }}>{addingMealType && formatDateForApi(date) === formatDateForApi(selectedDate) ? 'Adding…' : 'Add'}</Text></TouchableOpacity>
                </RNView>
              </RNView>;
            })}

            {/* Add to Grocery Button */}
            <TouchableOpacity
              style={[
                styles.groceryButton,
                { backgroundColor: colors.tint },
              ]}
              onPress={handleAddToGrocery}
              accessibilityRole="button" accessibilityLabel="Review week groceries"
              disabled={addToGrocery.isPending}
              activeOpacity={0.8}
            >
              {addToGrocery.isPending ? (
                <ActivityIndicator size="small" color={colors.onTint} />
              ) : (
                <>
                  <Ionicons name="cart-outline" size={20} color={colors.onTint} />
                  <Text style={[styles.groceryButtonText, { color: colors.onTint }]}>
                    Add Week to Grocery List
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <Modal visible={mealTypeDate !== null} onRequestClose={() => setMealTypeDate(null)} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, padding: 16, gap: 8 }}>
          <Text accessibilityRole="header" style={{ fontSize: 22, lineHeight: 28 }}>Meal type</Text>
          {MEAL_TYPES.map(meal => <TouchableOpacity key={meal.type} accessibilityRole="button" style={{ minHeight: 48, justifyContent: 'center' }}
            onPress={() => { const date = mealTypeDate; setMealTypeDate(null); if (date) handleAddMeal(meal.type, date); }}><Text>{meal.label}</Text></TouchableOpacity>)}
          <Button title="Cancel" variant="secondary" onPress={() => setMealTypeDate(null)} />
        </View>
      </Modal>
      <Modal visible={!!editingServings} onRequestClose={() => setEditingServings(null)} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, padding: spacing.lg, gap: spacing.md }}>
          <Text>Servings for {editingServings?.recipe_title}</Text>
          <TextInput accessibilityLabel="Planned servings" keyboardType="number-pad" value={servingsInput} onChangeText={setServingsInput} style={{ minHeight: 44, color: colors.text }} />
          <Button title="Save servings" disabled={!/^[1-9]\d{0,2}$/.test(servingsInput) || updateMeal.isPending} onPress={async () => {
            if (!editingServings) return;
            try { await updateMeal.mutateAsync({ entryId: editingServings.id, update: { planned_servings: Number(servingsInput) } }); setEditingServings(null); }
            catch { Alert.alert('Couldn’t save servings', 'Your plan was not changed. Try again.'); }
          }} />
          <Button title="Cancel" variant="secondary" onPress={() => setEditingServings(null)} />
        </View>
      </Modal>
      <Modal visible={reviewVisible} onRequestClose={() => { if (!reviewAdding) setReviewVisible(false); }} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, padding: spacing.lg, gap: spacing.md }}>
          <Text>Review this week’s groceries</Text>
          {review.isLoading && <ActivityIndicator accessibilityLabel="Loading grocery review" />}
          {review.isError && <Button title="Retry grocery review" onPress={() => review.refetch()} />}
          {reviewData && <>
            <Text>{reviewData.items_added} ingredient lines · {reviewData.items_missing_amount} missing amounts · {reviewData.items_unscaled} amounts need checking</Text>
            <ScrollView>
              {reviewData.totals.map((total, index) => <Text key={`total:${index}`} style={{ paddingVertical: spacing.sm }}>{total.quantity ?? 'See source amounts'} {total.unit} {total.name}{total.missing ? ` · ${total.missing} missing amounts` : ''}{total.uncombined ? ' · source amounts kept separate' : ''}</Text>)}
              <Text>By recipe</Text>
              {reviewData.items.map((item, index) => <Text key={index} style={{ paddingVertical: spacing.sm }}>{item.quantity ?? 'Amount not stated'} {item.unit} {item.name} · {item.recipe_title}</Text>)}</ScrollView>
            <Button title={reviewAdding ? 'Adding…' : 'Add reviewed groceries'} disabled={reviewAdding || (!pendingReview.current && (review.isFetching || review.isError)) || !reviewData.items_added} onPress={confirmGroceries} />
          </>}
          <Button title="Close review" variant="secondary" disabled={reviewAdding} onPress={() => setReviewVisible(false)} />
        </View>
      </Modal>
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
  signedOutScroll: {
    flex: 1,
  },
  signedOutContent: {
    padding: 16,
    gap: spacing.lg,
  },
  signedOutHero: {
    padding: spacing.xl,
    borderRadius: radius.xxl,
    borderWidth: 0,
  },
  signedOutHeroIcon: {
    width: 62,
    height: 62,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  signedOutEyebrow: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.sm,
  },
  signedOutTitle: {
    fontSize: fontSize.xxxl,
    fontFamily: fontFamily.display,
    lineHeight: 42,
    marginBottom: spacing.md,
  },
  signedOutSubtitle: {
    fontSize: fontSize.md,
    lineHeight: 23,
  },
  previewPlannerCard: {
    padding: 16,
    borderRadius: radius.xxl,
    borderWidth: 0,
  },
  previewPlannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  previewPlannerKicker: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  previewPlannerTitle: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.displaySemibold,
  },
  previewTodayBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  previewTodayText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  previewDayRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  previewDayPill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 58,
    borderRadius: radius.lg,
    borderWidth: 0,
  },
  previewDayText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  previewDayNumber: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    marginTop: 2,
  },
  previewMealStack: {
    gap: spacing.sm,
  },
  previewMealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 0,
  },
  previewMealIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  previewMealCopy: {
    flex: 1,
  },
  previewMealLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  previewMealTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
  },
  previewMealDetail: {
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  previewGroceryCallout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    marginTop: spacing.md,
  },
  previewGroceryText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    lineHeight: 19,
  },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  weekNavButton: {
    minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center',
  },
  weekLabelContainer: {
    justifyContent: 'center',
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  weekLabel: {
    flexShrink: 1,
    textAlign: 'center',
    lineHeight: 22,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  todayButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: radius.sm,
  },
  todayButtonText: {
    lineHeight: 16,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  dayStrip: {
    flexGrow: 1,
    gap: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
  },
  dayPill: {
    alignItems: 'center',
    justifyContent: 'center',
    width: Math.max(44, DAY_WIDTH),
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 0,
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
    padding: 16,
    paddingBottom: 80,
  },
  dayTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    marginBottom: 8, fontFamily: fontFamily.display, lineHeight: 25,
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
    marginBottom: 0,
  },
  mealSlotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  mealIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  mealLabel: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  addMealButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    minHeight: 44,
    paddingVertical: 8,
    borderRadius: 0,
    borderWidth: 0,
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
    borderWidth: 0,
  },
  mealThumbnail: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  mealCardContent: {
    flex: 1,
    marginLeft: spacing.sm,
    marginRight: spacing.sm,
  },
  mealCardTitle: {
    fontSize: 16, lineHeight: 21, fontFamily: fontFamily.display,
  },
  mealCardNotes: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  removeMealButton: {
    padding: spacing.xs,
  },
  addAnotherButton: {
    minHeight: 44, flexDirection: 'row', gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 0,
  },
  planHereButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 0,
  },
  planHereText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  groceryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    minHeight: 50,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  groceryButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
