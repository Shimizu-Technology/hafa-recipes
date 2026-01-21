/**
 * Global Timer Context
 * 
 * A simple data store for cook mode timers so the floating overlay
 * can display them when the user navigates away from cook mode.
 * 
 * Cook mode manages the actual timer logic (countdown, sound, notifications).
 * This context just shadows that data for display purposes.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'expo-router';
import { AppState, AppStateStatus } from 'react-native';

// Timer state for a single timer (mirrors cook mode's TimerState)
export interface TimerState {
  remaining: number;
  total: number;
  isPaused: boolean;
  endTime: number; // Unix timestamp when timer will complete
  stepText: string;
}

// Active cooking session info
export interface CookingSession {
  recipeId: string;
  recipeTitle: string;
  currentStep: number;
  totalSteps: number;
  scaleFactor?: number;
  servings?: number;
}

interface TimerContextValue {
  // Active timers (keyed by step index)
  timers: Map<number, TimerState>;
  
  // Current cooking session
  session: CookingSession | null;
  
  // Whether we're currently in cook mode
  isInCookMode: boolean;
  
  // Sync timers from cook mode (called whenever timers change)
  syncTimers: (timers: Map<number, TimerState>) => void;
  
  // Session management
  startSession: (session: CookingSession) => void;
  updateSession: (updates: Partial<CookingSession>) => void;
  endSession: () => void;
  
  // Check if any timer is active
  hasActiveTimers: boolean;
}

const TimerContext = createContext<TimerContextValue | null>(null);

export function useTimerContext() {
  const context = useContext(TimerContext);
  if (!context) {
    throw new Error('useTimerContext must be used within TimerProvider');
  }
  return context;
}

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const [timers, setTimers] = useState<Map<number, TimerState>>(new Map());
  const [session, setSession] = useState<CookingSession | null>(null);
  
  const pathname = usePathname();
  const isInCookMode = pathname?.startsWith('/cook-mode') ?? false;
  
  // Track app state for syncing when returning from background
  const appState = useRef<AppStateStatus>(AppState.currentState);
  
  // Check if any timer is running (not paused, time remaining)
  const hasActiveTimers = Array.from(timers.values()).some(
    t => t.remaining > 0
  );
  
  // Countdown effect - updates timer display when NOT in cook mode
  // Cook mode manages its own countdown, this is just for the floating overlay
  useEffect(() => {
    // Only run countdown when NOT in cook mode and we have active timers
    if (isInCookMode || timers.size === 0) return;
    
    const interval = setInterval(() => {
      const now = Date.now();
      
      setTimers(prev => {
        const updated = new Map(prev);
        let changed = false;
        
        updated.forEach((timer, stepIndex) => {
          if (!timer.isPaused && timer.remaining > 0 && timer.endTime > 0) {
            const newRemaining = Math.max(0, Math.floor((timer.endTime - now) / 1000));
            if (newRemaining !== timer.remaining) {
              updated.set(stepIndex, { ...timer, remaining: newRemaining });
              changed = true;
            }
          }
        });
        
        return changed ? updated : prev;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isInCookMode, timers.size]);
  
  // Handle app coming back from background - sync timers
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        !isInCookMode
      ) {
        // Sync timer remaining times based on endTime
        const now = Date.now();
        setTimers(prev => {
          const updated = new Map(prev);
          let changed = false;
          
          updated.forEach((timer, stepIndex) => {
            if (!timer.isPaused && timer.remaining > 0 && timer.endTime > 0) {
              const newRemaining = Math.max(0, Math.floor((timer.endTime - now) / 1000));
              if (newRemaining !== timer.remaining) {
                updated.set(stepIndex, { ...timer, remaining: newRemaining });
                changed = true;
              }
            }
          });
          
          return changed ? updated : prev;
        });
      }
      appState.current = nextAppState;
    });
    
    return () => subscription.remove();
  }, [isInCookMode]);
  
  // Sync timers from cook mode
  const syncTimers = useCallback((newTimers: Map<number, TimerState>) => {
    setTimers(new Map(newTimers));
  }, []);
  
  // Session management
  const startSession = useCallback((newSession: CookingSession) => {
    setSession(newSession);
  }, []);
  
  const updateSession = useCallback((updates: Partial<CookingSession>) => {
    setSession(prev => prev ? { ...prev, ...updates } : null);
  }, []);
  
  const endSession = useCallback(() => {
    setSession(null);
    setTimers(new Map());
  }, []);
  
  return (
    <TimerContext.Provider
      value={{
        timers,
        session,
        isInCookMode,
        syncTimers,
        startSession,
        updateSession,
        endSession,
        hasActiveTimers,
      }}
    >
      {children}
    </TimerContext.Provider>
  );
}
