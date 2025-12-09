/**
 * Offline storage utilities using AsyncStorage.
 * 
 * Provides caching and sync queue for grocery list when offline.
 * Uses "last write wins" conflict resolution for simplicity.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { GroceryItem, GroceryItemCreate } from '@/types/recipe';

// Storage keys
const STORAGE_KEYS = {
  GROCERY_LIST: '@hafa_grocery_list',
  GROCERY_COUNT: '@hafa_grocery_count',
  PENDING_SYNC: '@hafa_pending_sync',
  LAST_SYNC: '@hafa_last_sync',
};

// Types for sync queue
export type SyncAction = 
  | { type: 'ADD_ITEM'; payload: GroceryItemCreate & { tempId: string; recipe_id?: string; recipe_title?: string } }
  | { type: 'TOGGLE_ITEM'; payload: { id: string } }
  | { type: 'DELETE_ITEM'; payload: { id: string } }
  | { type: 'CLEAR_CHECKED' }
  | { type: 'CLEAR_ALL' }
  | { type: 'ADD_FROM_RECIPE'; payload: { recipeId: string; recipeTitle: string; items: GroceryItemCreate[] } };

interface PendingSync {
  id: string;
  action: SyncAction;
  timestamp: number;
}

// ============================================================
// GROCERY LIST CACHE
// ============================================================

/**
 * Save grocery list to local storage
 */
export async function cacheGroceryList(items: GroceryItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.GROCERY_LIST, JSON.stringify(items));
    await AsyncStorage.setItem(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
  } catch (error) {
    console.warn('Failed to cache grocery list:', error);
  }
}

/**
 * Load grocery list from local storage
 */
export async function getCachedGroceryList(): Promise<GroceryItem[] | null> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.GROCERY_LIST);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.warn('Failed to load cached grocery list:', error);
    return null;
  }
}

/**
 * Save grocery count to local storage
 */
export async function cacheGroceryCount(count: { total: number; checked: number; unchecked: number }): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.GROCERY_COUNT, JSON.stringify(count));
  } catch (error) {
    console.warn('Failed to cache grocery count:', error);
  }
}

/**
 * Load grocery count from local storage
 */
export async function getCachedGroceryCount(): Promise<{ total: number; checked: number; unchecked: number } | null> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.GROCERY_COUNT);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.warn('Failed to load cached grocery count:', error);
    return null;
  }
}

/**
 * Get last sync timestamp
 */
export async function getLastSyncTime(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEYS.LAST_SYNC);
  } catch {
    return null;
  }
}

// ============================================================
// OFFLINE SYNC QUEUE
// ============================================================

/**
 * Add an action to the pending sync queue
 */
export async function addToSyncQueue(action: SyncAction): Promise<void> {
  try {
    const queue = await getPendingSyncQueue();
    const newEntry: PendingSync = {
      id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      action,
      timestamp: Date.now(),
    };
    queue.push(newEntry);
    await AsyncStorage.setItem(STORAGE_KEYS.PENDING_SYNC, JSON.stringify(queue));
  } catch (error) {
    console.warn('Failed to add to sync queue:', error);
  }
}

/**
 * Get all pending sync actions
 */
export async function getPendingSyncQueue(): Promise<PendingSync[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_SYNC);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.warn('Failed to get sync queue:', error);
    return [];
  }
}

/**
 * Remove a specific action from the sync queue (after successful sync)
 */
export async function removeFromSyncQueue(syncId: string): Promise<void> {
  try {
    const queue = await getPendingSyncQueue();
    const filtered = queue.filter(item => item.id !== syncId);
    await AsyncStorage.setItem(STORAGE_KEYS.PENDING_SYNC, JSON.stringify(filtered));
  } catch (error) {
    console.warn('Failed to remove from sync queue:', error);
  }
}

/**
 * Clear the entire sync queue (after full sync)
 */
export async function clearSyncQueue(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.PENDING_SYNC, JSON.stringify([]));
  } catch (error) {
    console.warn('Failed to clear sync queue:', error);
  }
}

/**
 * Check if there are pending sync actions
 */
export async function hasPendingSync(): Promise<boolean> {
  const queue = await getPendingSyncQueue();
  return queue.length > 0;
}

// ============================================================
// LOCAL MUTATIONS (for offline mode)
// ============================================================

/**
 * Apply a toggle locally to the cached list
 */
export async function applyLocalToggle(itemId: string): Promise<GroceryItem[] | null> {
  const items = await getCachedGroceryList();
  if (!items) return null;
  
  const updated = items.map(item => 
    item.id === itemId ? { ...item, checked: !item.checked } : item
  );
  
  await cacheGroceryList(updated);
  await updateCachedCount(updated);
  return updated;
}

/**
 * Apply a delete locally to the cached list
 */
export async function applyLocalDelete(itemId: string): Promise<GroceryItem[] | null> {
  const items = await getCachedGroceryList();
  if (!items) return null;
  
  const updated = items.filter(item => item.id !== itemId);
  
  await cacheGroceryList(updated);
  await updateCachedCount(updated);
  return updated;
}

/**
 * Apply an add locally to the cached list
 */
export async function applyLocalAdd(item: GroceryItemCreate, tempId: string): Promise<GroceryItem[] | null> {
  const items = await getCachedGroceryList();
  if (!items) return null;
  
  const newItem: GroceryItem = {
    id: tempId,
    name: item.name,
    quantity: item.quantity || null,
    unit: item.unit || null,
    notes: item.notes || null,
    checked: false,
    recipe_id: item.recipe_id || null,
    recipe_title: item.recipe_title || null,
    created_at: new Date().toISOString(),
  };
  
  const updated = [newItem, ...items];
  
  await cacheGroceryList(updated);
  await updateCachedCount(updated);
  return updated;
}

/**
 * Apply clear checked locally
 */
export async function applyLocalClearChecked(): Promise<GroceryItem[] | null> {
  const items = await getCachedGroceryList();
  if (!items) return null;
  
  const updated = items.filter(item => !item.checked);
  
  await cacheGroceryList(updated);
  await updateCachedCount(updated);
  return updated;
}

/**
 * Apply clear all locally
 */
export async function applyLocalClearAll(): Promise<GroceryItem[]> {
  await cacheGroceryList([]);
  await cacheGroceryCount({ total: 0, checked: 0, unchecked: 0 });
  return [];
}

/**
 * Update the cached count based on items
 */
async function updateCachedCount(items: GroceryItem[]): Promise<void> {
  const count = {
    total: items.length,
    checked: items.filter(i => i.checked).length,
    unchecked: items.filter(i => !i.checked).length,
  };
  await cacheGroceryCount(count);
}

/**
 * Replace a temp ID with a real ID after successful server sync
 */
export async function replaceTempId(tempId: string, realId: string): Promise<void> {
  const items = await getCachedGroceryList();
  if (!items) return;
  
  const updated = items.map(item => 
    item.id === tempId ? { ...item, id: realId } : item
  );
  
  await cacheGroceryList(updated);
}

// ============================================================
// CLEAR ALL OFFLINE DATA
// ============================================================

/**
 * Clear all offline grocery data (for logout, etc.)
 */
export async function clearAllOfflineGroceryData(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.GROCERY_LIST,
      STORAGE_KEYS.GROCERY_COUNT,
      STORAGE_KEYS.PENDING_SYNC,
      STORAGE_KEYS.LAST_SYNC,
    ]);
  } catch (error) {
    console.warn('Failed to clear offline grocery data:', error);
  }
}

