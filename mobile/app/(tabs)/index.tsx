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
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/clerk-expo';
import * as ImagePicker from 'expo-image-picker';

import { View, Text, Input, Button, Chip, Card, useColors } from '@/components/Themed';
import ExtractionProgress from '@/components/ExtractionProgress';
import { SignInBanner } from '@/components/SignInBanner';
import { useAsyncExtraction, useLocations, useCheckDuplicate } from '@/hooks/useRecipes';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { api } from '@/lib/api';

export default function ExtractScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isSignedIn } = useAuth();
  
  // All hooks must be called unconditionally
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('Guam');
  const [isPublic, setIsPublic] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [isOcrExtracting, setIsOcrExtracting] = useState(false);
  const [ocrProgress, setOcrProgress] = useState('');
  const [selectedImages, setSelectedImages] = useState<string[]>([]); // Multi-image support
  const [showImageGallery, setShowImageGallery] = useState(false);
  
  const { data: locationsData } = useLocations();
  const extraction = useAsyncExtraction();
  const checkDuplicate = useCheckDuplicate();

  // Handle photo selection/capture for OCR
  const handleScanRecipe = async () => {
    Alert.alert(
      'Scan Recipe',
      'Take a photo of a recipe card or select images from your gallery.',
      [
        {
          text: 'Take Photo',
          onPress: () => pickImage('camera'),
        },
        {
          text: 'Choose from Gallery',
          onPress: () => pickImage('library'),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const pickImage = async (source: 'camera' | 'library') => {
    try {
      // Request permission
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Camera permission is needed to take photos.');
          return;
        }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Photo library permission is needed to select images.');
          return;
        }
      }

      // Launch picker - allow multiple for library, single for camera
      // Note: allowsEditing removed to capture full image (no cropping)
      // Quality increased to 0.95 for better OCR accuracy
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 0.95, // High quality for OCR
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: true, // Enable multi-select for gallery
            selectionLimit: 10,
            quality: 0.95, // High quality for OCR
          });

      if (!result.canceled && result.assets.length > 0) {
        const newImages = result.assets.map(asset => asset.uri);
        const allImages = [...selectedImages, ...newImages].slice(0, 10); // Max 10 images
        setSelectedImages(allImages);
        setShowImageGallery(true);
      }
    } catch (error: any) {
      console.error('Image picker error:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const removeImage = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  const clearImages = () => {
    setSelectedImages([]);
    setShowImageGallery(false);
  };

  const extractFromImages = async () => {
    if (selectedImages.length === 0) return;
    
    setIsOcrExtracting(true);
    setShowImageGallery(false);
    
    const imageCount = selectedImages.length;
    setOcrProgress(`Analyzing ${imageCount} image${imageCount > 1 ? 's' : ''}...`);

    try {
      setOcrProgress(`Extracting recipe with AI vision...`);
      
      // Use single or multi-image API based on count
      const result = imageCount === 1
        ? await api.extractRecipeFromImage(selectedImages[0], selectedLocation)
        : await api.extractRecipeFromMultipleImages(selectedImages, selectedLocation);
      
      if (result.success && result.recipe) {
        setOcrProgress('Recipe extracted!');
        setSelectedImages([]); // Clear images after success
        
        // Navigate to review screen with the extracted recipe
        router.push({
          pathname: '/ocr-review',
          params: {
            recipe: JSON.stringify(result.recipe),
            location: selectedLocation,
            isPublic: isPublic ? 'true' : 'false',
          },
        });
      } else {
        Alert.alert(
          'Extraction Failed',
          result.error || 'Could not extract recipe from image(s). Please try clearer images.'
        );
        setShowImageGallery(true); // Show gallery again to retry
      }
    } catch (error: any) {
      console.error('OCR extraction error:', error);
      Alert.alert(
        'Extraction Failed',
        error.message || 'Something went wrong. Please try again.'
      );
      setShowImageGallery(true); // Show gallery again to retry
    } finally {
      setIsOcrExtracting(false);
      setOcrProgress('');
    }
  };

  // Navigate to recipe when extraction completes
  useEffect(() => {
    if (extraction.isComplete && extraction.recipeId) {
      const timer = setTimeout(() => {
        router.push(`/recipe/${extraction.recipeId}`);
        extraction.reset();
        setUrl('');
        setNotes('');
        setIsPublic(true);
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

  const isLoading = isChecking || extraction.isExtracting || isOcrExtracting;

  // Show OCR progress UI
  if (isOcrExtracting) {
    return (
      <RNView style={[styles.container, { backgroundColor: colors.background }]}>
        <RNView style={styles.ocrProgressContainer}>
          <RNView style={[styles.ocrProgressCard, { backgroundColor: colors.backgroundSecondary }]}>
            <Ionicons name="scan" size={48} color={colors.tint} />
            <Text style={[styles.ocrProgressTitle, { color: colors.text }]}>
              Scanning Recipe
            </Text>
            <Text style={[styles.ocrProgressMessage, { color: colors.textSecondary }]}>
              {ocrProgress}
            </Text>
            <ActivityIndicator size="large" color={colors.tint} style={styles.ocrSpinner} />
            <Text style={[styles.ocrProgressHint, { color: colors.textMuted }]}>
              {selectedImages.length > 1 
                ? `Processing ${selectedImages.length} images may take longer...`
                : 'This may take 10-30 seconds depending on the image'}
            </Text>
          </RNView>
        </RNView>
      </RNView>
    );
  }

  // Show image gallery UI when images are selected
  if (showImageGallery && selectedImages.length > 0) {
    return (
      <RNView style={[styles.container, { backgroundColor: colors.background }]}>
        <RNView style={styles.galleryContainer}>
          {/* Header */}
          <RNView style={styles.galleryHeader}>
            <TouchableOpacity onPress={clearImages} style={styles.galleryBackButton}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.galleryTitle, { color: colors.text }]}>
              {selectedImages.length} {selectedImages.length === 1 ? 'Image' : 'Images'} Selected
            </Text>
            <RNView style={{ width: 40 }} />
          </RNView>

          {/* Image Grid */}
          <ScrollView 
            contentContainerStyle={styles.galleryGrid}
            showsVerticalScrollIndicator={false}
          >
            {selectedImages.map((uri, index) => (
              <RNView key={index} style={styles.galleryImageContainer}>
                <Image source={{ uri }} style={styles.galleryImage} />
                <TouchableOpacity
                  style={[styles.galleryRemoveButton, { backgroundColor: colors.error }]}
                  onPress={() => removeImage(index)}
                >
                  <Ionicons name="close" size={16} color="#FFFFFF" />
                </TouchableOpacity>
                <RNView style={[styles.galleryImageNumber, { backgroundColor: colors.tint }]}>
                  <Text style={styles.galleryImageNumberText}>{index + 1}</Text>
                </RNView>
              </RNView>
            ))}
            
            {/* Add More Button */}
            {selectedImages.length < 10 && (
              <TouchableOpacity
                style={[styles.galleryAddButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
                onPress={handleScanRecipe}
              >
                <Ionicons name="add" size={32} color={colors.tint} />
                <Text style={[styles.galleryAddText, { color: colors.textMuted }]}>Add Page</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* Info Text */}
          <Text style={[styles.galleryHint, { color: colors.textMuted }]}>
            {selectedImages.length === 1 
              ? '💡 Add more images for multi-page recipes'
              : `📄 ${selectedImages.length} pages will be combined into one recipe`}
          </Text>

          {/* Extract Button */}
          <RNView style={[styles.galleryBottomBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
            <Button
              title={`Extract Recipe from ${selectedImages.length} ${selectedImages.length === 1 ? 'Image' : 'Images'}`}
              onPress={extractFromImages}
              size="lg"
            />
          </RNView>
        </RNView>
      </RNView>
    );
  }

  // Show progress UI when extracting
  if (extraction.isExtracting || extraction.isFailed) {
    return (
      <RNView style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView 
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 80) + spacing.xl }]}
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
      </RNView>
    );
  }

  return (
    <RNView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView 
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView 
          contentContainerStyle={[
            styles.scrollContent, 
            { paddingBottom: Math.max(insets.bottom, 80) + spacing.xl + (isSignedIn ? 0 : 100) }
          ]}
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
              Paste a video URL to extract the recipe automatically.
            </Text>
          </RNView>

          {/* URL Input - Primary Action */}
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
              title={!isSignedIn ? 'Sign In to Extract' : isChecking ? 'Checking...' : 'Extract Recipe'}
              onPress={handleExtract}
              disabled={!isSignedIn || isLoading || !url.trim()}
              loading={isChecking}
              size="lg"
            />
          </RNView>

          {/* Divider */}
          <RNView style={styles.dividerContainer}>
            <RNView style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.textMuted }]}>or add another way</Text>
            <RNView style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </RNView>

          {/* Scan Recipe Button */}
          <TouchableOpacity
            style={[styles.scanButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
            onPress={handleScanRecipe}
            disabled={!isSignedIn || isLoading}
            activeOpacity={0.7}
          >
            <RNView style={[styles.scanIconContainer, { backgroundColor: colors.tint + '20' }]}>
              <Ionicons name="camera" size={28} color={colors.tint} />
            </RNView>
            <RNView style={styles.scanTextContainer}>
              <Text style={[styles.scanTitle, { color: colors.text }]}>
                Scan Recipe Card
              </Text>
              <Text style={[styles.scanSubtitle, { color: colors.textMuted }]}>
                Take a photo of a handwritten or printed recipe
              </Text>
            </RNView>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Add Manually Button */}
          <TouchableOpacity
            style={[styles.scanButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
            onPress={() => router.push('/add-recipe')}
            disabled={!isSignedIn || isLoading}
            activeOpacity={0.7}
          >
            <RNView style={[styles.scanIconContainer, { backgroundColor: colors.success + '20' }]}>
              <Ionicons name="create-outline" size={28} color={colors.success} />
            </RNView>
            <RNView style={styles.scanTextContainer}>
              <Text style={[styles.scanTitle, { color: colors.text }]}>
                Add Manually
              </Text>
              <Text style={[styles.scanSubtitle, { color: colors.textMuted }]}>
                Type in your own recipe from scratch
              </Text>
            </RNView>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Footer */}
          <RNView style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.textMuted }]}>
              Powered by AI • Gemini 2.0 & OpenAI
            </Text>
          </RNView>
        </ScrollView>
      </KeyboardAvoidingView>
      
      {/* Sign In Banner for guests */}
      {!isSignedIn && <SignInBanner message="Sign in to extract recipes" />}
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
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
    paddingVertical: spacing.md,
  },
  heroEmoji: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  heroTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.xs,
  },
  heroSubtitle: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
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
  // OCR/Scan styles
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  scanIconContainer: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  scanTextContainer: {
    flex: 1,
  },
  scanTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  scanSubtitle: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.md,
  },
  ocrProgressContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  ocrProgressCard: {
    width: '100%',
    padding: spacing.xl,
    borderRadius: radius.xl,
    alignItems: 'center',
  },
  ocrProgressTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  ocrProgressMessage: {
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  ocrSpinner: {
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  ocrProgressHint: {
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  // Image gallery styles
  galleryContainer: {
    flex: 1,
  },
  galleryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  galleryBackButton: {
    padding: spacing.sm,
  },
  galleryTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  galleryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: spacing.md,
    gap: spacing.md,
  },
  galleryImageContainer: {
    width: '30%',
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  galleryImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  galleryRemoveButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryImageNumber: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryImageNumberText: {
    color: '#FFFFFF',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  galleryAddButton: {
    width: '30%',
    aspectRatio: 1,
    borderRadius: radius.md,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryAddText: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  galleryHint: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  galleryBottomBar: {
    padding: spacing.lg,
    borderTopWidth: 1,
  },
});
