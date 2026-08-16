/**
 * React Query hooks for meal planning functionality.
 * Includes optimistic updates for instant UI feedback.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { MealPlanEntryCreate, WeekPlan, DayMeals, MealPlanEntry, MealType } from '@/types/recipe';

// Query keys
export const mealPlanKeys = {
  all: ['meal-plans'] as const,
  week: (weekOf?: string) => [...mealPlanKeys.all, 'week', weekOf || 'current'] as const,
  day: (date?: string) => [...mealPlanKeys.all, 'day', date || 'today'] as const,
};

/**
 * Get the meal plan for a specific week.
 */
export function useMealPlanWeek(weekOf?: string) {
  return useQuery({
    queryKey: mealPlanKeys.week(weekOf),
    queryFn: () => api.getMealPlanWeek(weekOf),
    staleTime: 30_000, // 30 seconds
  });
}

/**
 * Get the meal plan for a specific day.
 */
export function useMealPlanDay(date?: string) {
  return useQuery({
    queryKey: mealPlanKeys.day(date),
    queryFn: () => api.getMealPlanDay(date),
    staleTime: 30_000,
  });
}

/**
 * Add a meal to the plan with optimistic update.
 */
export function useAddMeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entry: MealPlanEntryCreate) => api.addMealPlanEntry(entry),
    
    // Optimistic update
    onMutate: async (newEntry) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: mealPlanKeys.all });

      // Snapshot the previous values for all week queries
      const previousWeekQueries = queryClient.getQueriesData<WeekPlan>({
        queryKey: mealPlanKeys.all,
      });

      // Create optimistic entry with temp ID
      const tempId = `temp-${Date.now()}`;
      const optimisticEntry: MealPlanEntry = {
        id: tempId,
        date: newEntry.date,
        meal_type: newEntry.meal_type,
        recipe_id: newEntry.recipe_id,
        recipe_title: newEntry.recipe_title,
        recipe_thumbnail: newEntry.recipe_thumbnail || null,
        notes: newEntry.notes || null,
        servings: newEntry.servings || null,
        created_at: new Date().toISOString(),
      };

      // Update all cached week queries
      queryClient.setQueriesData<WeekPlan>(
        { queryKey: mealPlanKeys.all },
        (old) => {
          if (!old) return old;
          
          return {
            ...old,
            days: old.days.map((day) => {
              if (day.date === newEntry.date) {
                return {
                  ...day,
                  [newEntry.meal_type]: [...day[newEntry.meal_type], optimisticEntry],
                };
              }
              return day;
            }),
          };
        }
      );

      return { previousWeekQueries, tempId, newEntry };
    },

    // On success, replace the temp entry with the real one (with real ID)
    onSuccess: (data, variables, context) => {
      if (!context) return;
      
      // Replace temp entry with real server response
      queryClient.setQueriesData<WeekPlan>(
        { queryKey: mealPlanKeys.all },
        (old) => {
          if (!old) return old;
          
          return {
            ...old,
            days: old.days.map((day) => {
              if (day.date === context.newEntry.date) {
                return {
                  ...day,
                  [context.newEntry.meal_type]: day[context.newEntry.meal_type].map((entry) =>
                    entry.id === context.tempId ? data : entry
                  ),
                };
              }
              return day;
            }),
          };
        }
      );
    },

    // On error, roll back to the previous value
    onError: (err, newEntry, context) => {
      if (context?.previousWeekQueries) {
        context.previousWeekQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    
    // No onSettled - we don't need to refetch since we handle success/error above
  });
}

/**
 * Update a meal plan entry.
 */
export function useUpdateMeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      entryId,
      update,
    }: {
      entryId: string;
      update: { meal_type?: string; date?: string; notes?: string; servings?: string };
    }) => api.updateMealPlanEntry(entryId, update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mealPlanKeys.all });
    },
  });
}

/**
 * Delete a meal from the plan with optimistic update.
 */
export function useDeleteMeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entryId: string) => api.deleteMealPlanEntry(entryId),
    
    // Optimistic update
    onMutate: async (entryId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: mealPlanKeys.all });

      // Snapshot the previous values
      const previousWeekQueries = queryClient.getQueriesData<WeekPlan>({
        queryKey: mealPlanKeys.all,
      });

      // Remove from all cached queries
      queryClient.setQueriesData<WeekPlan>(
        { queryKey: mealPlanKeys.all },
        (old) => {
          if (!old) return old;
          
          return {
            ...old,
            days: old.days.map((day) => ({
              ...day,
              breakfast: day.breakfast.filter((e) => e.id !== entryId),
              lunch: day.lunch.filter((e) => e.id !== entryId),
              dinner: day.dinner.filter((e) => e.id !== entryId),
              snack: day.snack.filter((e) => e.id !== entryId),
            })),
          };
        }
      );

      return { previousWeekQueries };
    },

    // On error, roll back
    onError: (err, entryId, context) => {
      if (context?.previousWeekQueries) {
        context.previousWeekQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    
    // No onSettled - optimistic update is already done, no need to refetch
  });
}

/**
 * Clear all meals for a day (or specific meal type).
 */
export function useClearDay() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ date, mealType }: { date: string; mealType?: string }) =>
      api.clearMealPlanDay(date, mealType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mealPlanKeys.all });
    },
  });
}

/**
 * Add all ingredients from the meal plan to the grocery list.
 */
export function useAddPlanToGrocery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ startDate, endDate }: { startDate: string; endDate: string }) =>
      api.addMealPlanToGrocery(startDate, endDate),
    onSuccess: () => {
      // Also invalidate grocery queries
      queryClient.invalidateQueries({ queryKey: ['grocery'] });
    },
  });
}

/**
 * Copy a week's meal plan to another week.
 */
export function useCopyWeek() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sourceWeek, targetWeek }: { sourceWeek: string; targetWeek: string }) =>
      api.copyMealPlanWeek(sourceWeek, targetWeek),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mealPlanKeys.all });
    },
  });
}

/**
 * Format a date as YYYY-MM-DD for API calls.
 */
export function formatDateForApi(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a YYYY-MM-DD string to a Date object.
 */
export function parseDateFromApi(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Get the Monday of the week containing the given date.
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  return new Date(d.setDate(diff));
}

/**
 * Get the Sunday of the week containing the given date.
 */
export function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
}

/**
 * Get an array of dates for a week (Monday to Sunday).
 */
export function getWeekDates(weekStart: Date): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    dates.push(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
  }
  return dates;
}

/**
 * Format a date for display (e.g., "Mon 9").
 */
export function formatDayLabel(date: Date): { day: string; number: string } {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    day: days[date.getDay()],
    number: String(date.getDate()),
  };
}

/**
 * Format a date for display (e.g., "Monday, Dec 9").
 */
export function formatFullDayLabel(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Check if a date is today.
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}
