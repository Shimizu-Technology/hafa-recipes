import { useState } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View as RNView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { View, Text, Input, Button, Chip, Card, useColors } from '@/components/Themed';
import { useExtractRecipe, useLocations, useCheckDuplicate } from '@/hooks/useRecipes';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

export default function ExtractScreen() {
  const router = useRouter();
  const colors = useColors();
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('Guam');
  
  const { data: locationsData } = useLocations();
  const extractMutation = useExtractRecipe();
  const checkDuplicate = useCheckDuplicate();

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
      // Check for duplicate first
      const duplicate = await checkDuplicate.mutateAsync(url.trim());
      
      if (duplicate.exists && duplicate.recipe_id) {
        Alert.alert(
          'Recipe Already Saved',
          `"${duplicate.title}" has already been extracted.`,
          [
            { text: 'View Recipe', onPress: () => router.push(`/recipe/${duplicate.recipe_id}`) },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
        return;
      }

      // Extract the recipe
      const result = await extractMutation.mutateAsync({
        url: url.trim(),
        location: selectedLocation,
        notes: notes.trim(),
      });

      // Navigate to the recipe detail
      router.push(`/recipe/${result.id}`);
      
      // Clear form
      setUrl('');
      setNotes('');
      
    } catch (error: any) {
      Alert.alert(
        'Extraction Failed',
        error.response?.data?.detail || error.message || 'Something went wrong. Please try again.'
      );
    }
  };

  const isLoading = extractMutation.isPending || checkDuplicate.isPending;

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

          {/* Extract Button */}
          <RNView style={styles.section}>
            <Button
              title={
                checkDuplicate.isPending 
                  ? 'Checking...' 
                  : extractMutation.isPending 
                    ? 'Extracting...' 
                    : 'Extract Recipe'
              }
              onPress={handleExtract}
              disabled={isLoading || !url.trim()}
              loading={isLoading}
              size="lg"
            />
            
            {isLoading && (
              <Text style={[styles.loadingHint, { color: colors.textMuted }]}>
                This may take 30-60 seconds...
              </Text>
            )}
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
  loadingHint: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  footer: {
    alignItems: 'center',
    paddingTop: spacing.xl,
  },
  footerText: {
    fontSize: fontSize.xs,
  },
});
