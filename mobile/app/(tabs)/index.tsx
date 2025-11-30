import { useState, useEffect } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View as RNView,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Input, Button, Chip, Card, useColors } from '@/components/Themed';
import ExtractionProgress from '@/components/ExtractionProgress';
import { useAsyncExtraction, useLocations, useCheckDuplicate } from '@/hooks/useRecipes';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

export default function ExtractScreen() {
  const router = useRouter();
  const colors = useColors();
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('Guam');
  const [isPublic, setIsPublic] = useState(true);  // Public by default
  const [isChecking, setIsChecking] = useState(false);
  
  const { data: locationsData } = useLocations();
  const extraction = useAsyncExtraction();
  const checkDuplicate = useCheckDuplicate();

  // Navigate to recipe when extraction completes
  useEffect(() => {
    if (extraction.isComplete && extraction.recipeId) {
      // Small delay to show completion state
      const timer = setTimeout(() => {
        router.push(`/recipe/${extraction.recipeId}`);
        // Reset after navigation
        extraction.reset();
        setUrl('');
        setNotes('');
        setIsPublic(true);  // Reset to default
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [extraction.isComplete, extraction.recipeId]);

  // Proceed with extraction (called after duplicate check or when user chooses "Extract Anyway")
  const proceedWithExtraction = async () => {
    try {
      const result = await extraction.startExtraction({
        url: url.trim(),
        location: selectedLocation,
        notes: notes.trim(),
        is_public: isPublic,
      });

      // If recipe already existed (shouldn't happen after duplicate check, but just in case)
      if (result.isExisting && result.recipeId) {
        router.push(`/recipe/${result.recipeId}`);
        setUrl('');
        setNotes('');
        setIsPublic(true);  // Reset to default
      }
      // Otherwise, polling has started and progress UI will show
    } catch (error: any) {
      Alert.alert(
        'Extraction Failed',
        error.message || 'Something went wrong. Please try again.'
      );
    }
  };

  const handleExtract = async () => {
    if (!url.trim()) {
      Alert.alert('Missing URL', 'Please paste a video URL to extract a recipe.');
      return;
    }

    // Validate URL format
    const urlLower = url.toLowerCase();
    if (!urlLower.includes('tiktok.com') && 
        !urlLower.includes('youtube.com') && 
        !urlLower.includes('youtu.be') &&
        !urlLower.includes('instagram.com')) {
      Alert.alert(
        'Invalid URL', 
        'Please enter a valid TikTok, YouTube, or Instagram video URL.'
      );
      return;
    }

    try {
      setIsChecking(true);
      
      // Check for duplicate first (both user's own and public recipes)
      console.log('Checking duplicate for URL:', url.trim());
      const duplicate = await checkDuplicate.mutateAsync(url.trim());
      console.log('Duplicate check result:', JSON.stringify(duplicate));
      
      if (duplicate.exists && duplicate.recipe_id) {
        setIsChecking(false);
        
        if (duplicate.owned_by_user) {
          // User already has this recipe
          Alert.alert(
            'Recipe Already Saved',
            `You already have "${duplicate.title}" in your recipes.`,
            [
              { text: 'View Recipe', onPress: () => router.push(`/recipe/${duplicate.recipe_id}`) },
              { text: 'Cancel', style: 'cancel' },
            ]
          );
        } else {
          // Someone else has already extracted this (public recipe)
          Alert.alert(
            'Recipe Already Extracted! 🎉',
            `"${duplicate.title}" is already in our library. View it instantly instead of waiting for extraction!`,
            [
              { 
                text: 'View Recipe', 
                onPress: () => router.push(`/recipe/${duplicate.recipe_id}`),
                style: 'default',
              },
              { 
                text: 'Extract Anyway', 
                onPress: () => proceedWithExtraction(),
                style: 'destructive',
              },
              { text: 'Cancel', style: 'cancel' },
            ]
          );
        }
        return;
      }

      setIsChecking(false);
      await proceedWithExtraction();
      
    } catch (error: any) {
      setIsChecking(false);
      Alert.alert(
        'Extraction Failed',
        error.message || 'Something went wrong. Please try again.'
      );
    }
  };

  const handleCancel = () => {
    Alert.alert(
      'Cancel Extraction?',
      'The extraction will continue in the background. You can check your history for the result.',
      [
        { text: 'Keep Waiting', style: 'cancel' },
        { 
          text: 'Go to History', 
          onPress: () => {
            router.push('/history');
          }
        },
      ]
    );
  };

  const handleRetry = () => {
    extraction.reset();
  };

  const isLoading = isChecking || extraction.isExtracting;

  // Show progress UI when extracting
  if (extraction.isExtracting || extraction.isFailed) {
    return (
      <View style={styles.container}>
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <ExtractionProgress
            progress={extraction.progress}
            currentStep={extraction.currentStep}
            message={extraction.message}
            elapsedTime={extraction.elapsedTime}
            error={extraction.error}
          />

          {extraction.isFailed ? (
            <RNView style={styles.buttonRow}>
              <Button
                title="Try Again"
                onPress={handleRetry}
                size="lg"
              />
            </RNView>
          ) : (
            <RNView style={styles.buttonRow}>
              <Button
                title="Cancel"
                onPress={handleCancel}
                variant="secondary"
                size="lg"
              />
            </RNView>
          )}

          <Text style={[styles.backgroundHint, { color: colors.textMuted }]}>
            💡 You can leave this screen - extraction continues in the background
          </Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView 
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Hero Section */}
          <RNView style={styles.hero}>
            <Text style={[styles.heroEmoji]}>🍳</Text>
            <Text style={[styles.heroTitle, { color: colors.text }]}>
              Recipe Extractor
            </Text>
            <Text style={[styles.heroSubtitle, { color: colors.textSecondary }]}>
              Paste a cooking video URL and we'll extract the recipe for you.
            </Text>
          </RNView>

          {/* URL Input */}
          <RNView style={styles.section}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Video URL
            </Text>
            <Input
              value={url}
              onChangeText={setUrl}
              placeholder="https://www.tiktok.com/..."
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
            />
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              Supports TikTok, YouTube, and Instagram
            </Text>
          </RNView>

          {/* Location Selector */}
          <RNView style={styles.section}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Location for cost estimates
            </Text>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.locationScroll}
            >
              {/* Sort locations so Guam is first */}
              {locationsData?.locations
                .slice()
                .sort((a, b) => {
                  if (a.name === 'Guam') return -1;
                  if (b.name === 'Guam') return 1;
                  return 0;
                })
                .map((loc) => (
                  <Chip
                    key={loc.code}
                    label={loc.name}
                    selected={selectedLocation === loc.name}
                    onPress={() => !isLoading && setSelectedLocation(loc.name)}
                  />
                ))}
            </ScrollView>
          </RNView>

          {/* Notes Input */}
          <RNView style={styles.section}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Additional notes <Text style={{ color: colors.textMuted }}>(optional)</Text>
            </Text>
            <Input
              value={notes}
              onChangeText={setNotes}
              placeholder="Any details you noticed in the video..."
              multiline
              numberOfLines={3}
              editable={!isLoading}
            />
          </RNView>

          {/* Share Toggle */}
          <TouchableOpacity 
            style={[
              styles.shareToggle, 
              { 
                backgroundColor: isPublic ? colors.tint + '15' : colors.backgroundSecondary,
                borderColor: isPublic ? colors.tint : colors.border,
              }
            ]}
            onPress={() => !isLoading && setIsPublic(!isPublic)}
            activeOpacity={0.7}
            disabled={isLoading}
          >
            <RNView style={styles.shareToggleContent}>
              <Ionicons 
                name={isPublic ? 'globe' : 'lock-closed'} 
                size={20} 
                color={isPublic ? colors.tint : colors.textMuted} 
              />
              <RNView style={styles.shareToggleText}>
                <Text style={[styles.shareToggleTitle, { color: colors.text }]}>
                  {isPublic ? 'Share to Library' : 'Keep Private'}
                </Text>
                <Text style={[styles.shareToggleSubtitle, { color: colors.textMuted }]}>
                  {isPublic ? 'Others can discover this recipe' : 'Only visible to you'}
                </Text>
              </RNView>
            </RNView>
            <Switch
              value={isPublic}
              onValueChange={setIsPublic}
              disabled={isLoading}
              trackColor={{ false: colors.border, true: colors.tint }}
              thumbColor="#FFFFFF"
            />
          </TouchableOpacity>

          {/* Extract Button */}
          <RNView style={styles.section}>
            <Button
              title={isChecking ? 'Checking...' : 'Extract Recipe'}
              onPress={handleExtract}
              disabled={isLoading || !url.trim()}
              loading={isChecking}
              size="lg"
            />
          </RNView>

          {/* Footer */}
          <RNView style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.textMuted }]}>
              Powered by OpenAI Whisper & GPT-4o-mini
            </Text>
          </RNView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  heroEmoji: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  heroTitle: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.sm,
  },
  heroSubtitle: {
    fontSize: fontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  section: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: fontSize.xs,
    marginTop: spacing.sm,
  },
  locationScroll: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  footer: {
    alignItems: 'center',
    paddingTop: spacing.xl,
  },
  footerText: {
    fontSize: fontSize.xs,
  },
  buttonRow: {
    marginTop: spacing.md,
  },
  backgroundHint: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  shareToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  shareToggleContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
  },
  shareToggleText: {
    flex: 1,
  },
  shareToggleTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  shareToggleSubtitle: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
});
