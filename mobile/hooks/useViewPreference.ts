/**
 * Hook to manage and persist recipe list view preference (grid vs list)
 */
import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ViewMode = 'list' | 'grid';

const VIEW_PREFERENCE_KEY = '@recipe_view_preference';

export function useViewPreference() {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load preference from storage
  useEffect(() => {
    const loadPreference = async () => {
      try {
        const stored = await AsyncStorage.getItem(VIEW_PREFERENCE_KEY);
        if (stored === 'grid' || stored === 'list') {
          setViewMode(stored);
        }
      } catch (error) {
        console.error('Failed to load view preference:', error);
      } finally {
        setIsLoaded(true);
      }
    };
    loadPreference();
  }, []);

  // Toggle and persist preference
  const toggleViewMode = useCallback(async () => {
    const newMode: ViewMode = viewMode === 'list' ? 'grid' : 'list';
    setViewMode(newMode);
    try {
      await AsyncStorage.setItem(VIEW_PREFERENCE_KEY, newMode);
    } catch (error) {
      console.error('Failed to save view preference:', error);
    }
  }, [viewMode]);

  return {
    viewMode,
    toggleViewMode,
    isLoaded,
    isGrid: viewMode === 'grid',
    isList: viewMode === 'list',
  };
}
