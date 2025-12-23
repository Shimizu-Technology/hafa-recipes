/**
 * ExtractionProgress component - shows real-time extraction progress
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from './useColorScheme';

interface ExtractionProgressProps {
  progress: number; // 0-100
  currentStep: string;
  message: string;
  elapsedTime: number; // seconds
  error?: string | null;
  isWebsite?: boolean; // true for website extraction, false for video
}

// Map backend step names to display info - VIDEO extraction
const VIDEO_STEP_CONFIG: Record<string, { label: string; order: number }> = {
  initializing: { label: 'Starting...', order: 0 },
  detecting: { label: 'Detecting platform', order: 1 },
  metadata: { label: 'Fetching video info', order: 2 },
  downloading: { label: 'Downloading audio', order: 3 },
  transcribing: { label: 'Transcribing with AI', order: 4 },
  metadata_fallback: { label: 'Fetching metadata', order: 4 },
  extracting: { label: 'Extracting recipe', order: 5 },
  saving: { label: 'Saving thumbnail', order: 6 },
  complete: { label: 'Complete!', order: 7 },
  error: { label: 'Error', order: -1 },
};

// Map backend step names to display info - WEBSITE extraction
const WEBSITE_STEP_CONFIG: Record<string, { label: string; order: number }> = {
  initializing: { label: 'Starting...', order: 0 },
  fetching: { label: 'Fetching webpage', order: 1 },
  extracting: { label: 'Extracting recipe', order: 2 },
  saving: { label: 'Saving thumbnail', order: 3 },
  complete: { label: 'Complete!', order: 4 },
  error: { label: 'Error', order: -1 },
};

// Main steps to display
const VIDEO_STEPS = ['downloading', 'transcribing', 'extracting', 'saving'];
const WEBSITE_STEPS = ['fetching', 'extracting', 'saving'];

/**
 * Animated text that displays a smoothly changing number
 */
function AnimatedProgressText({ value, color }: { value: Animated.Value; color: string }) {
  const [displayValue, setDisplayValue] = React.useState(0);
  
  useEffect(() => {
    const listener = value.addListener(({ value: v }) => {
      setDisplayValue(Math.round(v));
    });
    return () => value.removeListener(listener);
  }, [value]);
  
  return (
    <Text style={[styles.progressText, { color }]}>{displayValue}%</Text>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function getEstimatedRemaining(progress: number, elapsed: number): string {
  if (progress <= 0 || elapsed <= 0) return '~60s';
  const estimated = Math.round((elapsed / progress) * (100 - progress));
  if (estimated > 120) return '~2 min';
  if (estimated > 60) return '~1 min';
  return `~${estimated}s`;
}

export default function ExtractionProgress({
  progress,
  currentStep,
  message,
  elapsedTime,
  error,
  isWebsite = false,
}: ExtractionProgressProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  // Use website or video step config based on extraction type
  const STEP_CONFIG = isWebsite ? WEBSITE_STEP_CONFIG : VIDEO_STEP_CONFIG;
  const STEPS = isWebsite ? WEBSITE_STEPS : VIDEO_STEPS;
  const currentStepOrder = STEP_CONFIG[currentStep]?.order ?? 0;
  
  // Animated progress value for smooth transitions
  const animatedProgress = useRef(new Animated.Value(0)).current;
  const displayProgress = useRef(new Animated.Value(0)).current;
  
  // Animate progress smoothly when it changes
  useEffect(() => {
    Animated.parallel([
      // Animate the progress bar fill
      Animated.timing(animatedProgress, {
        toValue: progress,
        duration: 800,
        useNativeDriver: false, // Width animation can't use native driver
      }),
      // Animate the displayed number
      Animated.timing(displayProgress, {
        toValue: progress,
        duration: 800,
        useNativeDriver: false,
      }),
    ]).start();
  }, [progress]);

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color="#ef4444" />
          <Text style={styles.errorTitle}>Extraction Failed</Text>
          <Text style={[styles.errorMessage, { color: colors.text }]}>{error}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
      <Text style={[styles.title, { color: colors.text }]}>Extracting Recipe</Text>
      
      {/* Steps list */}
      <View style={styles.stepsContainer}>
        {STEPS.map((step, index) => {
          const stepInfo = STEP_CONFIG[step];
          const isCompleted = currentStepOrder > stepInfo.order;
          const isCurrent = currentStep === step;
          
          return (
            <View key={step} style={styles.stepRow}>
              <View style={styles.stepIconContainer}>
                {isCompleted ? (
                  <Ionicons name="checkmark-circle" size={24} color={colors.accent} />
                ) : isCurrent ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <View style={[styles.stepCircle, { borderColor: colors.border }]} />
                )}
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  { color: colors.text },
                  isCompleted && styles.stepLabelCompleted,
                  isCurrent && { color: colors.accent, fontWeight: '600' },
                  !isCompleted && !isCurrent && { opacity: 0.5 },
                ]}
                numberOfLines={1}
              >
                {stepInfo.label}
              </Text>
              {isCompleted && (
                <Ionicons name="checkmark" size={16} color={colors.accent} style={styles.checkIcon} />
              )}
            </View>
          );
        })}
      </View>

      {/* Progress bar */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <Animated.View
            style={[
              styles.progressFill,
              { 
                backgroundColor: colors.accent,
                width: animatedProgress.interpolate({
                  inputRange: [0, 100],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>
        <AnimatedProgressText value={displayProgress} color={colors.text} />
      </View>

      {/* Time info */}
      <View style={styles.timeContainer}>
        <View style={styles.timeItem}>
          <Ionicons name="time-outline" size={16} color={colors.text} style={{ opacity: 0.6 }} />
          <Text style={[styles.timeText, { color: colors.text }]}>
            {formatTime(elapsedTime)} elapsed
          </Text>
        </View>
        <View style={styles.timeItem}>
          <Ionicons name="hourglass-outline" size={16} color={colors.text} style={{ opacity: 0.6 }} />
          <Text style={[styles.timeText, { color: colors.text }]}>
            {getEstimatedRemaining(progress, elapsedTime)} remaining
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 24,
    marginVertical: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 24,
  },
  stepsContainer: {
    marginBottom: 24,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  stepIconContainer: {
    width: 32,
    alignItems: 'center',
  },
  stepCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
  },
  stepLabel: {
    fontSize: 16,
    marginLeft: 12,
    flex: 1,
  },
  stepLabelCompleted: {
    textDecorationLine: 'line-through',
    opacity: 0.7,
  },
  checkIcon: {
    marginLeft: 8,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  progressTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    marginLeft: 12,
    fontSize: 14,
    fontWeight: '600',
    minWidth: 40,
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  timeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeText: {
    fontSize: 13,
    opacity: 0.8,
  },
  errorContainer: {
    alignItems: 'center',
    padding: 16,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ef4444',
    marginTop: 12,
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});

