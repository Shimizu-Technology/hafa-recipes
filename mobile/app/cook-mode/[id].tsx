import { useEffect, useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View as RNView,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  ScrollView,
  Animated,
  Modal,
  Vibration,
  AppState,
  AppStateStatus,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Audio } from 'expo-av';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, useColors } from '@/components/Themed';
import { useRecipe } from '@/hooks/useRecipes';
import { useTimerSoundPreference, getTimerSoundFile } from '@/hooks/useTimerSound';
import { useBackgroundTimer } from '@/hooks/useBackgroundTimer';
import { lightHaptic, mediumHaptic, successHaptic, heavyHaptic } from '@/utils/haptics';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { RecipeComponent, Ingredient } from '@/types/recipe';
import { scaleQuantity } from '@/hooks/useScaledServings';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.2;

interface CookingStep {
  step: string;
  componentName: string | null;
  stepNumber: number;
  totalSteps: number;
}

interface TimerState {
  remaining: number;
  total: number;
  isPaused: boolean;
  endTime: number; // Unix timestamp when timer will complete
}

// Extract time patterns from step text
function extractTimeFromStep(step: string): { time: number; unit: string; display: string } | null {
  let totalMinutes = 0;
  let totalSeconds = 0;
  let displayParts: string[] = [];
  
  // Pattern for hours (handles "1 hour", "2 hours", "1-2 hours", "1 to 2 hours")
  const hourPattern = /(\d+)\s*(?:[-–to]+\s*\d+\s*)?(?:hour|hr)s?/gi;
  const hourMatches = step.matchAll(hourPattern);
  for (const match of hourMatches) {
    const hours = parseInt(match[1], 10);
    totalMinutes += hours * 60;
    displayParts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  }
  
  // Pattern for minutes (handles "15 minutes", "30 min", "15-20 minutes")
  const minutePattern = /(\d+)\s*(?:[-–to]+\s*\d+\s*)?(?:minute|min)s?/gi;
  const minuteMatches = step.matchAll(minutePattern);
  for (const match of minuteMatches) {
    const minutes = parseInt(match[1], 10);
    totalMinutes += minutes;
    displayParts.push(`${minutes} min`);
  }
  
  // Pattern for seconds (handles "30 seconds", "45 sec")
  const secondPattern = /(\d+)\s*(?:[-–to]+\s*\d+\s*)?(?:second|sec)s?/gi;
  const secondMatches = step.matchAll(secondPattern);
  for (const match of secondMatches) {
    const seconds = parseInt(match[1], 10);
    totalSeconds += seconds;
    displayParts.push(`${seconds} sec`);
  }
  
  // If we found any time
  if (totalMinutes > 0 || totalSeconds > 0) {
    // Convert everything to the most appropriate unit
    if (totalMinutes > 0 && totalSeconds > 0) {
      // Both minutes and seconds - convert all to seconds
      const totalInSeconds = (totalMinutes * 60) + totalSeconds;
      return { 
        time: totalInSeconds, 
        unit: 'seconds', 
        display: displayParts.join(' ') 
      };
    } else if (totalMinutes > 0) {
      return { 
        time: totalMinutes, 
        unit: 'minutes', 
        display: displayParts.join(' ') 
      };
    } else {
      return { 
        time: totalSeconds, 
        unit: 'seconds', 
        display: displayParts.join(' ') 
      };
    }
  }
  
  return null;
}

export default function CookModeScreen() {
  const { id, scaleFactor: scaleFactorParam, servings: servingsParam } = useLocalSearchParams<{ 
    id: string; 
    scaleFactor?: string;
    servings?: string;
  }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  
  const { data: recipe, isLoading, error } = useRecipe(id);
  
  // Parse scaling params
  const scaleFactor = scaleFactorParam ? parseFloat(scaleFactorParam) : 1;
  const currentServings = servingsParam ? parseInt(servingsParam, 10) : null;
  const isScaled = scaleFactor !== 1 && currentServings !== null;
  
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [activeTimers, setActiveTimers] = useState<Map<number, TimerState>>(new Map());
  const [showComplete, setShowComplete] = useState(false);
  const [showIngredients, setShowIngredients] = useState(false);
  const [showCustomTimer, setShowCustomTimer] = useState(false);
  const [showEditTimer, setShowEditTimer] = useState(false);
  const [customHours, setCustomHours] = useState('');
  const [customMinutes, setCustomMinutes] = useState('');
  const [customSeconds, setCustomSeconds] = useState('');
  const [gestureX, setGestureX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  
  // Timer presets in minutes
  const TIMER_PRESETS = [1, 5, 10, 15, 20, 30, 45, 60];
  
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const soundRef = useRef<Audio.Sound | null>(null);
  
  // Timer sound preference
  const { soundPreference } = useTimerSoundPreference();
  
  // Background timer notifications
  const {
    scheduleTimerNotification,
    cancelTimerNotification,
    cancelAllTimerNotifications,
    pauseTimerNotification,
    resumeTimerNotification,
    getRemainingTime,
  } = useBackgroundTimer();
  
  // Track app state for syncing timers
  const appState = useRef<AppStateStatus>(AppState.currentState);

  // Get all steps from recipe
  const getAllSteps = useCallback((): CookingStep[] => {
    if (!recipe?.extracted) return [];
    
    const { components, steps: legacySteps } = recipe.extracted;
    const allSteps: CookingStep[] = [];
    let stepCounter = 0;

    if (components && components.length > 0) {
      components.forEach((component: RecipeComponent) => {
        component.steps?.forEach((step: string) => {
          stepCounter++;
          allSteps.push({
            step,
            componentName: components.length > 1 ? component.name : null,
            stepNumber: stepCounter,
            totalSteps: 0,
          });
        });
      });
    } else if (legacySteps && legacySteps.length > 0) {
      legacySteps.forEach((step: string, index: number) => {
        allSteps.push({
          step,
          componentName: null,
          stepNumber: index + 1,
          totalSteps: 0,
        });
      });
    }

    allSteps.forEach(s => {
      s.totalSteps = allSteps.length;
    });

    return allSteps;
  }, [recipe]);

  const steps = getAllSteps();
  const currentStep = steps[currentStepIndex];
  const detectedTime = currentStep ? extractTimeFromStep(currentStep.step) : null;
  const currentTimer = activeTimers.get(currentStepIndex);
  const isLastStep = currentStepIndex === steps.length - 1;

  // Get all ingredients
  const allIngredients = recipe?.extracted?.components?.flatMap(
    (c: RecipeComponent) => c.ingredients
  ) || [];

  // Keep screen awake
  useEffect(() => {
    activateKeepAwakeAsync('cook-mode');
    return () => {
      deactivateKeepAwake('cook-mode');
    };
  }, []);

  // Load completion sound based on preference
  useEffect(() => {
    const loadSound = async () => {
      // Unload previous sound if any
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      
      // Get sound file based on preference
      const soundFile = getTimerSoundFile(soundPreference);
      if (!soundFile) return; // 'none' preference
      
      try {
        const { sound } = await Audio.Sound.createAsync(
          soundFile,
          { shouldPlay: false }
        );
        soundRef.current = sound;
      } catch (e) {
        console.log('Timer sound not available');
      }
    };
    loadSound();
    
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, [soundPreference]);

  // Handle app state changes - sync timers when coming back from background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App has come to foreground - sync timer remaining times
        console.log('📱 App foregrounded - syncing timers');
        setActiveTimers(prev => {
          const newTimers = new Map(prev);
          let changed = false;
          
          newTimers.forEach((timer, stepIndex) => {
            if (!timer.isPaused && timer.remaining > 0) {
              // Calculate actual remaining time based on endTime
              const now = Date.now();
              const actualRemaining = Math.max(0, Math.floor((timer.endTime - now) / 1000));
              
              if (actualRemaining !== timer.remaining) {
                newTimers.set(stepIndex, { ...timer, remaining: actualRemaining });
                changed = true;
                console.log(`⏱️ Synced step ${stepIndex}: ${timer.remaining}s → ${actualRemaining}s`);
              }
              
              // If timer completed while in background
              if (actualRemaining === 0 && timer.remaining > 0) {
                // Play sound and vibrate
                heavyHaptic();
                Vibration.vibrate([0, 500, 200, 500, 200, 500]);
                soundRef.current?.replayAsync().catch(() => {});
              }
            }
          });
          
          return changed ? newTimers : prev;
        });
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // Timer countdown effect - uses endTime for accurate tracking
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveTimers(prev => {
        const newTimers = new Map(prev);
        let changed = false;
        let timerJustCompleted = false;
        
        newTimers.forEach((timer, stepIndex) => {
          if (timer.remaining > 0 && !timer.isPaused) {
            // Calculate remaining based on endTime for accuracy
            const now = Date.now();
            const newRemaining = Math.max(0, Math.floor((timer.endTime - now) / 1000));
            
            if (newRemaining !== timer.remaining) {
              newTimers.set(stepIndex, { ...timer, remaining: newRemaining });
              changed = true;
              
              if (newRemaining === 0) {
                timerJustCompleted = true;
              }
            }
          }
        });
        
        if (timerJustCompleted) {
          // Play sound and vibrate
          heavyHaptic();
          Vibration.vibrate([0, 500, 200, 500, 200, 500]);
          soundRef.current?.replayAsync().catch(() => {});
        }
        
        return changed ? newTimers : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const animateTransition = (direction: 'next' | 'prev', callback: () => void) => {
    const toValue = direction === 'next' ? -SCREEN_WIDTH : SCREEN_WIDTH;
    
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      callback();
      slideAnim.setValue(direction === 'next' ? SCREEN_WIDTH : -SCREEN_WIDTH);
      
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  const goToNextStep = useCallback(() => {
    if (currentStepIndex < steps.length - 1) {
      lightHaptic();
      animateTransition('next', () => {
        setCurrentStepIndex(prev => Math.min(prev + 1, steps.length - 1));
      });
    } else if (currentStepIndex === steps.length - 1) {
      // Show completion screen
      successHaptic();
      setShowComplete(true);
    }
  }, [currentStepIndex, steps.length]);

  const goToPrevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      lightHaptic();
      animateTransition('prev', () => {
        setCurrentStepIndex(prev => Math.max(prev - 1, 0));
      });
    }
  }, [currentStepIndex]);

  // Swipe handlers
  const handleTouchStart = (e: any) => {
    setGestureX(e.nativeEvent.pageX);
    setIsSwiping(true);
  };

  const handleTouchEnd = (e: any) => {
    if (!isSwiping) return;
    setIsSwiping(false);
    
    const dx = e.nativeEvent.pageX - gestureX;
    
    if (dx < -SWIPE_THRESHOLD && currentStepIndex < steps.length - 1) {
      goToNextStep();
    } else if (dx > SWIPE_THRESHOLD && currentStepIndex > 0) {
      goToPrevStep();
    }
  };

  // Timer controls - with background notification support
  const startTimer = async () => {
    if (detectedTime && !currentTimer) {
      mediumHaptic();
      const totalSeconds = detectedTime.unit === 'seconds' 
        ? detectedTime.time 
        : detectedTime.time * 60;
      
      const endTime = Date.now() + (totalSeconds * 1000);
      
      setActiveTimers(prev => {
        const newTimers = new Map(prev);
        newTimers.set(currentStepIndex, { 
          remaining: totalSeconds, 
          total: totalSeconds, 
          isPaused: false,
          endTime,
        });
        return newTimers;
      });
      
      // Schedule background notification
      await scheduleTimerNotification(
        currentStepIndex,
        totalSeconds,
        currentStep?.step || 'Timer complete!',
        soundPreference
      );
    }
  };

  const startCustomTimer = async (minutes: number) => {
    await startTimerWithSeconds(minutes * 60);
  };

  const startTimerWithSeconds = async (totalSeconds: number) => {
    if (totalSeconds <= 0) return;
    
    mediumHaptic();
    const endTime = Date.now() + (totalSeconds * 1000);
    
    setActiveTimers(prev => {
      const newTimers = new Map(prev);
      newTimers.set(currentStepIndex, { 
        remaining: totalSeconds, 
        total: totalSeconds, 
        isPaused: false,
        endTime,
      });
      return newTimers;
    });
    setShowCustomTimer(false);
    setShowEditTimer(false);
    setCustomHours('');
    setCustomMinutes('');
    setCustomSeconds('');
    
    // Schedule background notification
    await scheduleTimerNotification(
      currentStepIndex,
      totalSeconds,
      currentStep?.step || 'Timer complete!',
      soundPreference
    );
  };

  const handleStartCustomInput = async () => {
    const hours = parseInt(customHours) || 0;
    const minutes = parseInt(customMinutes) || 0;
    const seconds = parseInt(customSeconds) || 0;
    const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;
    
    if (totalSeconds > 0) {
      await startTimerWithSeconds(totalSeconds);
    }
  };

  const openEditTimer = () => {
    if (detectedTime) {
      // Pre-fill with detected time
      const totalMins = detectedTime.unit === 'seconds' 
        ? Math.floor(detectedTime.time / 60) 
        : detectedTime.time;
      const hours = Math.floor(totalMins / 60);
      const mins = totalMins % 60;
      const secs = detectedTime.unit === 'seconds' ? detectedTime.time % 60 : 0;
      
      setCustomHours(hours > 0 ? hours.toString() : '');
      setCustomMinutes(mins > 0 ? mins.toString() : '');
      setCustomSeconds(secs > 0 ? secs.toString() : '');
    }
    setShowEditTimer(true);
  };

  const togglePauseTimer = async () => {
    if (currentTimer && currentTimer.remaining > 0) {
      lightHaptic();
      const nowPaused = !currentTimer.isPaused;
      
      if (nowPaused) {
        // Pausing - cancel the notification
        await pauseTimerNotification(currentStepIndex);
        setActiveTimers(prev => {
          const newTimers = new Map(prev);
          newTimers.set(currentStepIndex, { 
            ...currentTimer, 
            isPaused: true,
            // Keep remaining time as-is (will resume from here)
          });
          return newTimers;
        });
      } else {
        // Resuming - reschedule notification with remaining time
        const newEndTime = Date.now() + (currentTimer.remaining * 1000);
        setActiveTimers(prev => {
          const newTimers = new Map(prev);
          newTimers.set(currentStepIndex, { 
            ...currentTimer, 
            isPaused: false,
            endTime: newEndTime,
          });
          return newTimers;
        });
        await resumeTimerNotification(
          currentStepIndex,
          currentTimer.remaining,
          currentStep?.step || 'Timer complete!',
          soundPreference
        );
      }
    }
  };

  const resetTimer = async () => {
    if (currentTimer) {
      mediumHaptic();
      const newEndTime = Date.now() + (currentTimer.total * 1000);
      
      setActiveTimers(prev => {
        const newTimers = new Map(prev);
        newTimers.set(currentStepIndex, { 
          remaining: currentTimer.total, 
          total: currentTimer.total, 
          isPaused: false,
          endTime: newEndTime,
        });
        return newTimers;
      });
      
      // Reschedule notification with full time
      await scheduleTimerNotification(
        currentStepIndex,
        currentTimer.total,
        currentStep?.step || 'Timer complete!',
        soundPreference
      );
    }
  };

  const stopTimer = async () => {
    lightHaptic();
    
    // Cancel the notification
    await cancelTimerNotification(currentStepIndex);
    
    setActiveTimers(prev => {
      const newTimers = new Map(prev);
      newTimers.delete(currentStepIndex);
      return newTimers;
    });
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleClose = () => {
    lightHaptic();
    router.back();
  };

  const handleFinish = () => {
    successHaptic();
    router.back();
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar barStyle="light-content" />
        <RNView style={styles.loadingContainer}>
          <Ionicons name="restaurant-outline" size={48} color="#FF6B35" />
          <Text style={styles.loadingText}>Preparing your recipe...</Text>
        </RNView>
      </View>
    );
  }

  if (error || !recipe || steps.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar barStyle="light-content" />
        <RNView style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#FF6B35" />
          <Text style={styles.errorText}>
            {steps.length === 0 ? 'No steps found for this recipe' : 'Failed to load recipe'}
          </Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeErrorButton}>
            <Text style={styles.closeErrorText}>Go Back</Text>
          </TouchableOpacity>
        </RNView>
      </View>
    );
  }

  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <RNView style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <TouchableOpacity onPress={handleClose} style={styles.headerButton}>
          <Ionicons name="close" size={26} color="#ffffff" />
        </TouchableOpacity>
        
        <RNView style={styles.headerCenter}>
          <Text style={styles.recipeTitle} numberOfLines={1}>
            {recipe.extracted.title}
          </Text>
        </RNView>

        <TouchableOpacity onPress={() => setShowIngredients(true)} style={styles.headerButton}>
          <Ionicons name="list-outline" size={24} color="#ffffff" />
        </TouchableOpacity>
      </RNView>

      {/* Step Counter & Progress */}
      <RNView style={styles.progressSection}>
        <Text style={styles.stepCounter}>
          Step {currentStepIndex + 1} <Text style={styles.stepCounterMuted}>of {steps.length}</Text>
        </Text>
        <RNView style={styles.progressContainer}>
          <RNView style={[styles.progressBar, { width: `${progress}%` }]} />
        </RNView>
      </RNView>

      {/* Main Content */}
      <Animated.View
        style={[
          styles.stepContainer,
          {
            transform: [{ translateX: slideAnim }],
            opacity: fadeAnim,
          },
        ]}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Component Name Badge */}
        {currentStep?.componentName && (
          <RNView style={styles.componentBadge}>
            <Text style={styles.componentName}>{currentStep.componentName}</Text>
          </RNView>
        )}

        {/* Step Text */}
        <ScrollView 
          style={styles.stepScrollView}
          contentContainerStyle={styles.stepScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.stepText}>{currentStep?.step}</Text>
        </ScrollView>

        {/* Timer Section */}
          <RNView style={styles.timerSection}>
            {currentTimer ? (
              <RNView style={styles.timerCard}>
                {/* Timer Display */}
                <RNView style={styles.timerDisplay}>
                  <Ionicons 
                    name={currentTimer.remaining === 0 ? "checkmark-circle" : (currentTimer.isPaused ? "pause-circle" : "time")} 
                    size={28} 
                    color={currentTimer.remaining === 0 ? "#4CAF50" : "#FF6B35"} 
                  />
                  <Text style={[
                    styles.timerText,
                    currentTimer.remaining === 0 && styles.timerComplete
                  ]}>
                    {currentTimer.remaining === 0 ? "Timer Done!" : formatTime(currentTimer.remaining)}
                  </Text>
                </RNView>
                
                {/* Progress Bar */}
                <RNView style={styles.timerProgress}>
                  <RNView 
                    style={[
                      styles.timerProgressFill, 
                      { width: `${((currentTimer.total - currentTimer.remaining) / currentTimer.total) * 100}%` }
                    ]} 
                  />
                </RNView>

                {/* Timer Controls */}
                <RNView style={styles.timerControls}>
                  {currentTimer.remaining > 0 ? (
                    <>
                      <TouchableOpacity onPress={togglePauseTimer} style={styles.timerControlButton}>
                        <Ionicons 
                          name={currentTimer.isPaused ? "play" : "pause"} 
                          size={22} 
                          color="#ffffff" 
                        />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={resetTimer} style={styles.timerControlButton}>
                        <Ionicons name="refresh" size={22} color="#ffffff" />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={stopTimer} style={styles.timerControlButton}>
                        <Ionicons name="stop" size={22} color="#ffffff" />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity onPress={resetTimer} style={styles.timerRestartButton}>
                      <Ionicons name="refresh" size={20} color="#ffffff" />
                      <Text style={styles.timerRestartText}>Restart Timer</Text>
                    </TouchableOpacity>
                  )}
                </RNView>
              </RNView>
          ) : detectedTime ? (
              <RNView style={styles.detectedTimerRow}>
                <TouchableOpacity onPress={startTimer} style={styles.timerButton}>
                  <Ionicons name="timer-outline" size={22} color="#ffffff" />
                  <Text style={styles.timerButtonText}>Start {detectedTime.display} timer</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={openEditTimer} style={styles.editTimerButton}>
                  <Ionicons name="pencil" size={18} color="#ffffff" />
                </TouchableOpacity>
              </RNView>
          ) : (
            <TouchableOpacity onPress={() => setShowCustomTimer(true)} style={styles.addTimerButton}>
              <Ionicons name="add-circle-outline" size={22} color="#888" />
              <Text style={styles.addTimerButtonText}>Add Timer</Text>
            </TouchableOpacity>
            )}
          </RNView>
      </Animated.View>

      {/* Navigation */}
      <RNView style={[styles.navigation, { paddingBottom: insets.bottom + spacing.sm }]}>
        <TouchableOpacity
          onPress={goToPrevStep}
          style={[styles.navButton, currentStepIndex === 0 && styles.navButtonDisabled]}
          disabled={currentStepIndex === 0}
        >
          <Ionicons name="chevron-back" size={28} color={currentStepIndex === 0 ? '#444' : '#ffffff'} />
          <Text style={[styles.navButtonText, currentStepIndex === 0 && styles.navButtonTextDisabled]}>
            Back
          </Text>
        </TouchableOpacity>

        <RNView style={styles.stepDots}>
          {steps.slice(Math.max(0, currentStepIndex - 2), Math.min(steps.length, currentStepIndex + 3)).map((_, i) => {
            const actualIndex = Math.max(0, currentStepIndex - 2) + i;
            return (
              <RNView
                key={actualIndex}
                style={[
                  styles.stepDot,
                  actualIndex === currentStepIndex && styles.stepDotActive,
                  actualIndex < currentStepIndex && styles.stepDotCompleted,
                ]}
              />
            );
          })}
        </RNView>

        <TouchableOpacity
          onPress={goToNextStep}
          style={[styles.navButton, styles.navButtonNext]}
        >
          <Text style={styles.navButtonText}>
            {isLastStep ? 'Finish' : 'Next'}
          </Text>
          <Ionicons 
            name={isLastStep ? "checkmark" : "chevron-forward"} 
            size={28} 
            color="#ffffff" 
          />
        </TouchableOpacity>
      </RNView>

      {/* Completion Modal */}
      <Modal
        visible={showComplete}
        animationType="fade"
        transparent={true}
      >
        <RNView style={styles.modalOverlay}>
          <RNView style={styles.completeCard}>
            <Text style={styles.completeEmoji}>🎉</Text>
            <Text style={styles.completeTitle}>Recipe Complete!</Text>
            <Text style={styles.completeSubtitle}>{recipe.extracted.title}</Text>
            <Text style={styles.completeMessage}>
              Great job! You've finished all {steps.length} steps.
            </Text>
            <TouchableOpacity onPress={handleFinish} style={styles.completeButton}>
              <Text style={styles.completeButtonText}>Done Cooking</Text>
            </TouchableOpacity>
          </RNView>
        </RNView>
      </Modal>

      {/* Ingredients Modal */}
      <Modal
        visible={showIngredients}
        animationType="slide"
        transparent={true}
      >
        <RNView style={styles.modalOverlay}>
          <RNView style={[styles.ingredientsCard, { paddingBottom: insets.bottom + spacing.lg }]}>
            <RNView style={styles.ingredientsHeader}>
              <RNView>
                <Text style={styles.ingredientsTitle}>Ingredients</Text>
                {isScaled && currentServings && (
                  <Text style={styles.ingredientsSubtitle}>{currentServings} servings (scaled)</Text>
                )}
              </RNView>
              <TouchableOpacity onPress={() => setShowIngredients(false)} style={styles.closeIngredients}>
                <Ionicons name="close" size={28} color="#ffffff" />
              </TouchableOpacity>
            </RNView>
            <ScrollView style={styles.ingredientsList} showsVerticalScrollIndicator={false}>
              {allIngredients.map((ing: Ingredient, index: number) => {
                const scaledQty = scaleQuantity(ing.quantity ?? null, scaleFactor);
                return (
                  <RNView key={index} style={styles.ingredientRow}>
                    <Text style={[styles.ingredientQuantity, isScaled && styles.ingredientQuantityScaled]}>
                      {scaledQty ? `${scaledQty}${ing.unit ? ` ${ing.unit}` : ''}` : '•'}
                    </Text>
                    <Text style={styles.ingredientName}>{ing.name}</Text>
                  </RNView>
                );
              })}
            </ScrollView>
          </RNView>
        </RNView>
      </Modal>

      {/* Custom Timer Modal */}
      <Modal
        visible={showCustomTimer}
        animationType="fade"
        transparent={true}
      >
        <KeyboardAvoidingView 
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity 
            style={styles.modalOverlayTouch} 
            activeOpacity={1} 
            onPress={() => setShowCustomTimer(false)}
          >
            <RNView style={styles.customTimerCard} onStartShouldSetResponder={() => true}>
              <Text style={styles.customTimerTitle}>Set Timer</Text>
              <Text style={styles.customTimerSubtitle}>Quick presets</Text>
              
              <RNView style={styles.timerPresetGrid}>
                {TIMER_PRESETS.map((minutes) => (
                  <TouchableOpacity
                    key={minutes}
                    style={styles.timerPresetButton}
                    onPress={() => startCustomTimer(minutes)}
                  >
                    <Text style={styles.timerPresetValue}>
                      {minutes >= 60 ? `${minutes / 60}` : minutes}
                    </Text>
                    <Text style={styles.timerPresetUnit}>
                      {minutes >= 60 ? 'hour' : 'min'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </RNView>

              {/* Custom Input Section */}
              <Text style={[styles.customTimerSubtitle, { marginTop: spacing.lg }]}>Or enter custom time</Text>
              <RNView style={styles.customInputRow}>
                <RNView style={styles.customInputGroup}>
                  <TextInput
                    style={styles.customTimeInput}
                    value={customHours}
                    onChangeText={setCustomHours}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor="#666"
                    maxLength={2}
                  />
                  <Text style={styles.customInputLabel}>hrs</Text>
                </RNView>
                <Text style={styles.customInputSeparator}>:</Text>
                <RNView style={styles.customInputGroup}>
                  <TextInput
                    style={styles.customTimeInput}
                    value={customMinutes}
                    onChangeText={setCustomMinutes}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor="#666"
                    maxLength={2}
                  />
                  <Text style={styles.customInputLabel}>min</Text>
                </RNView>
                <Text style={styles.customInputSeparator}>:</Text>
                <RNView style={styles.customInputGroup}>
                  <TextInput
                    style={styles.customTimeInput}
                    value={customSeconds}
                    onChangeText={setCustomSeconds}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor="#666"
                    maxLength={2}
                  />
                  <Text style={styles.customInputLabel}>sec</Text>
                </RNView>
              </RNView>
              
              <TouchableOpacity 
                style={[
                  styles.startCustomButton,
                  (!customHours && !customMinutes && !customSeconds) && styles.startCustomButtonDisabled
                ]} 
                onPress={handleStartCustomInput}
                disabled={!customHours && !customMinutes && !customSeconds}
              >
                <Ionicons name="play" size={18} color="#ffffff" />
                <Text style={styles.startCustomButtonText}>Start Timer</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.customTimerCancel} 
                onPress={() => {
                  setShowCustomTimer(false);
                  setCustomHours('');
                  setCustomMinutes('');
                  setCustomSeconds('');
                }}
              >
                <Text style={styles.customTimerCancelText}>Cancel</Text>
              </TouchableOpacity>
            </RNView>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Detected Timer Modal */}
      <Modal
        visible={showEditTimer}
        animationType="fade"
        transparent={true}
      >
        <KeyboardAvoidingView 
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity 
            style={styles.modalOverlayTouch} 
            activeOpacity={1} 
            onPress={() => setShowEditTimer(false)}
          >
            <RNView style={styles.customTimerCard} onStartShouldSetResponder={() => true}>
              <Text style={styles.customTimerTitle}>Edit Timer</Text>
              <Text style={styles.customTimerSubtitle}>
                {detectedTime ? `Detected: ${detectedTime.display}` : 'Set your preferred time'}
              </Text>
              
              <RNView style={styles.customInputRow}>
                <RNView style={styles.customInputGroup}>
                  <TextInput
                    style={styles.customTimeInput}
                    value={customHours}
                    onChangeText={setCustomHours}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor="#666"
                    maxLength={2}
                  />
                  <Text style={styles.customInputLabel}>hrs</Text>
                </RNView>
                <Text style={styles.customInputSeparator}>:</Text>
                <RNView style={styles.customInputGroup}>
                  <TextInput
                    style={styles.customTimeInput}
                    value={customMinutes}
                    onChangeText={setCustomMinutes}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor="#666"
                    maxLength={2}
                  />
                  <Text style={styles.customInputLabel}>min</Text>
                </RNView>
                <Text style={styles.customInputSeparator}>:</Text>
                <RNView style={styles.customInputGroup}>
                  <TextInput
                    style={styles.customTimeInput}
                    value={customSeconds}
                    onChangeText={setCustomSeconds}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor="#666"
                    maxLength={2}
                  />
                  <Text style={styles.customInputLabel}>sec</Text>
                </RNView>
              </RNView>
              
              <TouchableOpacity 
                style={[
                  styles.startCustomButton,
                  (!customHours && !customMinutes && !customSeconds) && styles.startCustomButtonDisabled
                ]} 
                onPress={handleStartCustomInput}
                disabled={!customHours && !customMinutes && !customSeconds}
              >
                <Ionicons name="play" size={18} color="#ffffff" />
                <Text style={styles.startCustomButtonText}>Start Timer</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.customTimerCancel} 
                onPress={() => {
                  setShowEditTimer(false);
                  setCustomHours('');
                  setCustomMinutes('');
                  setCustomSeconds('');
                }}
              >
                <Text style={styles.customTimerCancelText}>Cancel</Text>
              </TouchableOpacity>
            </RNView>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
  loadingText: {
    color: '#888',
    fontSize: fontSize.lg,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  errorText: {
    color: '#888',
    fontSize: fontSize.lg,
    textAlign: 'center',
  },
  closeErrorButton: {
    backgroundColor: '#FF6B35',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  closeErrorText: {
    color: '#ffffff',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  headerButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 22,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  recipeTitle: {
    color: '#999',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  progressSection: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  stepCounter: {
    color: '#FF6B35',
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  stepCounterMuted: {
    color: '#666',
    fontWeight: fontWeight.normal,
  },
  progressContainer: {
    height: 4,
    backgroundColor: '#2a2a2a',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#FF6B35',
    borderRadius: 2,
  },
  stepContainer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  componentBadge: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 107, 53, 0.15)',
    borderWidth: 1,
    borderColor: '#FF6B35',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    marginBottom: spacing.md,
  },
  componentName: {
    color: '#FF6B35',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  stepScrollView: {
    flex: 1,
  },
  stepScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  stepText: {
    color: '#ffffff',
    fontSize: 26,
    lineHeight: 40,
    fontWeight: fontWeight.normal,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  timerSection: {
    paddingVertical: spacing.md,
  },
  timerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e1e1e',
    borderWidth: 1,
    borderColor: '#333',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.sm,
    flex: 1,
  },
  timerButtonText: {
    color: '#ffffff',
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  detectedTimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  editTimerButton: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  timerDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  timerText: {
    color: '#FF6B35',
    fontSize: 42,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  timerComplete: {
    color: '#4CAF50',
    fontSize: 28,
  },
  timerProgress: {
    height: 4,
    backgroundColor: '#2a2a2a',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  timerProgressFill: {
    height: '100%',
    backgroundColor: '#FF6B35',
  },
  timerControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  timerControlButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timerRestartButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  timerRestartText: {
    color: '#ffffff',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  navigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    backgroundColor: '#0f0f0f',
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  navButtonNext: {
    backgroundColor: '#FF6B35',
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
  },
  navButtonDisabled: {
    opacity: 0.3,
  },
  navButtonText: {
    color: '#ffffff',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  navButtonTextDisabled: {
    color: '#444',
  },
  stepDots: {
    flexDirection: 'row',
    gap: 6,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#333',
  },
  stepDotActive: {
    backgroundColor: '#FF6B35',
    width: 24,
  },
  stepDotCompleted: {
    backgroundColor: '#666',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlayTouch: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  completeCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  completeEmoji: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  completeTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.xs,
  },
  completeSubtitle: {
    color: '#FF6B35',
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  completeMessage: {
    color: '#888',
    fontSize: fontSize.md,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  completeButton: {
    backgroundColor: '#FF6B35',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl * 2,
    borderRadius: radius.lg,
  },
  completeButtonText: {
    color: '#ffffff',
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  ingredientsCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '70%',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: '#2a2a2a',
  },
  ingredientsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  ingredientsTitle: {
    color: '#ffffff',
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  ingredientsSubtitle: {
    color: '#4ECDC4',
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  closeIngredients: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ingredientsList: {
    padding: spacing.lg,
  },
  ingredientRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  ingredientQuantity: {
    color: '#FF6B35',
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    width: 100,
  },
  ingredientQuantityScaled: {
    color: '#4ECDC4', // Teal to indicate scaled
  },
  ingredientName: {
    color: '#ffffff',
    fontSize: fontSize.md,
    flex: 1,
  },
  // Add Timer Button (when no detected time)
  addTimerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#333',
    borderStyle: 'dashed',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  addTimerButtonText: {
    color: '#888',
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  // Custom Timer Modal
  customTimerCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    alignItems: 'center',
  },
  customTimerTitle: {
    color: '#ffffff',
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.xs,
  },
  customTimerSubtitle: {
    color: '#888',
    fontSize: fontSize.sm,
    marginBottom: spacing.lg,
  },
  timerPresetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  timerPresetButton: {
    width: 70,
    height: 70,
    borderRadius: radius.lg,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  timerPresetValue: {
    color: '#FF6B35',
    fontSize: 24,
    fontWeight: fontWeight.bold,
  },
  timerPresetUnit: {
    color: '#888',
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  customTimerCancel: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  customTimerCancelText: {
    color: '#888',
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  customInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  customInputGroup: {
    alignItems: 'center',
  },
  customTimeInput: {
    width: 60,
    height: 50,
    backgroundColor: '#2a2a2a',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#444',
    color: '#ffffff',
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
  customInputLabel: {
    color: '#888',
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  customInputSeparator: {
    color: '#666',
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.lg,
  },
  startCustomButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF6B35',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  startCustomButtonDisabled: {
    backgroundColor: '#444',
    opacity: 0.5,
  },
  startCustomButtonText: {
    color: '#ffffff',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
