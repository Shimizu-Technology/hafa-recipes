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
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Audio } from 'expo-av';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, useColors } from '@/components/Themed';
import { useRecipe } from '@/hooks/useRecipes';
import { lightHaptic, mediumHaptic, successHaptic, heavyHaptic } from '@/utils/haptics';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { RecipeComponent, Ingredient } from '@/types/recipe';

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
}

// Extract time patterns from step text
function extractTimeFromStep(step: string): { time: number; unit: string; display: string } | null {
  const patterns = [
    /(\d+)\s*(?:to\s*\d+\s*)?hour(?:s)?/i,
    /(\d+)\s*(?:to\s*\d+\s*)?minute(?:s)?/i,
    /(\d+)\s*(?:to\s*\d+\s*)?min(?:s)?/i,
    /(\d+)\s*(?:to\s*\d+\s*)?second(?:s)?/i,
    /(\d+)\s*(?:to\s*\d+\s*)?sec(?:s)?/i,
  ];

  for (const pattern of patterns) {
    const match = step.match(pattern);
    if (match) {
      const value = parseInt(match[1], 10);
      const fullMatch = match[0].toLowerCase();
      
      if (fullMatch.includes('hour')) {
        return { time: value * 60, unit: 'minutes', display: `${value} hour${value > 1 ? 's' : ''}` };
      } else if (fullMatch.includes('min')) {
        return { time: value, unit: 'minutes', display: `${value} min` };
      } else if (fullMatch.includes('sec')) {
        return { time: value, unit: 'seconds', display: `${value} sec` };
      }
    }
  }
  return null;
}

export default function CookModeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  
  const { data: recipe, isLoading, error } = useRecipe(id);
  
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [activeTimers, setActiveTimers] = useState<Map<number, TimerState>>(new Map());
  const [showComplete, setShowComplete] = useState(false);
  const [showIngredients, setShowIngredients] = useState(false);
  const [showCustomTimer, setShowCustomTimer] = useState(false);
  const [gestureX, setGestureX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  
  // Timer presets in minutes
  const TIMER_PRESETS = [1, 5, 10, 15, 20, 30, 45, 60];
  
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const soundRef = useRef<Audio.Sound | null>(null);

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

  // Load completion sound
  useEffect(() => {
    const loadSound = async () => {
      try {
        const { sound } = await Audio.Sound.createAsync(
          require('@/assets/sounds/timer-complete.mp3'),
          { shouldPlay: false }
        );
        soundRef.current = sound;
      } catch (e) {
        // Sound file may not exist, that's ok
        console.log('Timer sound not available');
      }
    };
    loadSound();
    
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, []);

  // Timer countdown effect
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveTimers(prev => {
        const newTimers = new Map(prev);
        let changed = false;
        let timerJustCompleted = false;
        
        newTimers.forEach((timer, stepIndex) => {
          if (timer.remaining > 0 && !timer.isPaused) {
            const newRemaining = timer.remaining - 1;
            newTimers.set(stepIndex, { ...timer, remaining: newRemaining });
            changed = true;
            
            if (newRemaining === 0) {
              timerJustCompleted = true;
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

  // Timer controls
  const startTimer = () => {
    if (detectedTime && !currentTimer) {
      mediumHaptic();
      const totalSeconds = detectedTime.unit === 'seconds' 
        ? detectedTime.time 
        : detectedTime.time * 60;
      
      setActiveTimers(prev => {
        const newTimers = new Map(prev);
        newTimers.set(currentStepIndex, { remaining: totalSeconds, total: totalSeconds, isPaused: false });
        return newTimers;
      });
    }
  };

  const startCustomTimer = (minutes: number) => {
    mediumHaptic();
    const totalSeconds = minutes * 60;
    setActiveTimers(prev => {
      const newTimers = new Map(prev);
      newTimers.set(currentStepIndex, { remaining: totalSeconds, total: totalSeconds, isPaused: false });
      return newTimers;
    });
    setShowCustomTimer(false);
  };

  const togglePauseTimer = () => {
    if (currentTimer && currentTimer.remaining > 0) {
      lightHaptic();
      setActiveTimers(prev => {
        const newTimers = new Map(prev);
        newTimers.set(currentStepIndex, { ...currentTimer, isPaused: !currentTimer.isPaused });
        return newTimers;
      });
    }
  };

  const resetTimer = () => {
    if (currentTimer) {
      mediumHaptic();
      setActiveTimers(prev => {
        const newTimers = new Map(prev);
        newTimers.set(currentStepIndex, { remaining: currentTimer.total, total: currentTimer.total, isPaused: false });
        return newTimers;
      });
    }
  };

  const stopTimer = () => {
    lightHaptic();
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
              <TouchableOpacity onPress={startTimer} style={styles.timerButton}>
                <Ionicons name="timer-outline" size={22} color="#ffffff" />
                <Text style={styles.timerButtonText}>Start {detectedTime.display} timer</Text>
              </TouchableOpacity>
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
              <Text style={styles.ingredientsTitle}>Ingredients</Text>
              <TouchableOpacity onPress={() => setShowIngredients(false)} style={styles.closeIngredients}>
                <Ionicons name="close" size={28} color="#ffffff" />
              </TouchableOpacity>
            </RNView>
            <ScrollView style={styles.ingredientsList} showsVerticalScrollIndicator={false}>
              {allIngredients.map((ing: Ingredient, index: number) => (
                <RNView key={index} style={styles.ingredientRow}>
                  <Text style={styles.ingredientQuantity}>
                    {ing.quantity ? `${ing.quantity}${ing.unit ? ` ${ing.unit}` : ''}` : '•'}
                  </Text>
                  <Text style={styles.ingredientName}>{ing.name}</Text>
                </RNView>
              ))}
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
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setShowCustomTimer(false)}
        >
          <RNView style={styles.customTimerCard}>
            <Text style={styles.customTimerTitle}>Set Timer</Text>
            <Text style={styles.customTimerSubtitle}>Choose a duration</Text>
            
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

            <TouchableOpacity 
              style={styles.customTimerCancel} 
              onPress={() => setShowCustomTimer(false)}
            >
              <Text style={styles.customTimerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </RNView>
        </TouchableOpacity>
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
  },
  timerButtonText: {
    color: '#ffffff',
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
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
});
