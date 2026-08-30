import { useState, useEffect } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View as RNView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/expo';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';

import { View, Text, Input, Button, Chip, useColors } from '@/components/Themed';
import ExtractionProgress from '@/components/ExtractionProgress';
import { SignInBanner } from '@/components/SignInBanner';
import { guestPromptBottomPadding, useGuestPromptHeight } from '../../lib/guestPromptLayout';
import { useLocations, useCheckDuplicate } from '@/hooks/useRecipes';
import { useAsyncExtraction } from '@/contexts/ExtractionContext';
import { BrandMark } from '@/components/BrandMark';
import { spacing, fontSize, fontWeight, radius, fontFamily } from '@/constants/Colors';
import { api, type RecipeImageUpload } from '@/lib/api';
import { consumePendingShareCapture } from '@/lib/shareCapture';
import { usePublishingDisclosure } from '@/hooks/usePublishingDisclosure';

export default function ExtractScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isSignedIn } = useAuth();
  const guestPromptHeight = useGuestPromptHeight();
  const { sharedUrl, captureToken } = useLocalSearchParams<{
    sharedUrl?: string;
    captureToken?: string;
  }>();

  const handleWebsiteSupportPress = () => {
    Linking.openURL('mailto:shimizutechnology@gmail.com?subject=H%C3%A5fa%20Recipes%20website%20extraction%20issue');
  };

  // All hooks must be called unconditionally
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('Guam');
  const [isPublic, setIsPublic] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isOcrExtracting, setIsOcrExtracting] = useState(false);
  const [ocrProgress, setOcrProgress] = useState('');
  const [extractingAsWebsite, setExtractingAsWebsite] = useState(false); // Track extraction type to prevent flicker
  const [selectedImages, setSelectedImages] = useState<RecipeImageUpload[]>([]); // Multi-image support
  const [showImageGallery, setShowImageGallery] = useState(false);

  const { data: locationsData } = useLocations();
  const extraction = useAsyncExtraction();
  const checkDuplicate = useCheckDuplicate();
  const { requestPublishing, isCheckingDisclosure } = usePublishingDisclosure();

  const handlePublicToggle = async () => {
    if (!isSignedIn) return;
    if (isPublic) {
      setIsPublic(false);
      return;
    }
    if (await requestPublishing()) setIsPublic(true);
  };

  // Handle shared URL from iOS Share Extension
  useEffect(() => {
    if (!sharedUrl) return;
    if (sharedUrl !== url) setUrl(sharedUrl);
    // Clear the param by navigating to same screen without params
    router.setParams({ sharedUrl: undefined });
  }, [router, sharedUrl, url]);

  // Shared images stay in memory only until this screen consumes the route token.
  useEffect(() => {
    if (!captureToken) return;
    const capture = consumePendingShareCapture(captureToken);
    router.setParams({ captureToken: undefined });
    if (capture?.kind !== 'images') return;

    setSelectedImages(capture.images.map((image, index) => {
      const extension = image.mimeType.split('/')[1].replace('jpeg', 'jpg');
      return {
        uri: image.uri,
        mimeType: image.mimeType,
        fileName: `shared-recipe-${index + 1}.${extension}`,
      };
    }));
    setShowImageGallery(true);
  }, [captureToken, router]);

  // Handle photo selection/capture for OCR
  const handleScanRecipe = async () => {
    Alert.alert(
      'Import Recipe Images',
      'Take a photo or choose up to 10 screenshots, recipe cards, or cookbook pages.',
      [
        {
          text: 'Take Photo',
          onPress: () => pickImage('camera'),
        },
        {
          text: 'Choose Screenshots or Photos',
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
        const newImages = result.assets.map((asset) => ({ uri: asset.uri }));
        const allImages = [...selectedImages, ...newImages].slice(0, 10); // Max 10 images
        setSelectedImages(allImages);
        setShowImageGallery(true);
      }
    } catch {
      // User-facing alert is sufficient
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
      // User-facing alert is sufficient
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
      const navigateToRecipe = () => {
        router.push(`/recipe/${extraction.recipeId}`);
        extraction.reset();
        setUrl('');
        setNotes('');
        setIsPublic(false);
        setExtractingAsWebsite(false);
      };

      // Show warning if low confidence extraction
      if (extraction.lowConfidence && extraction.confidenceWarning) {
        const timer = setTimeout(() => {
          Alert.alert(
            "Recipe May Need Review",
            extraction.confidenceWarning + "\n\nYou can edit the recipe to fix any issues.",
            [
              {
                text: "Review Recipe",
                onPress: navigateToRecipe,
              }
            ]
          );
        }, 500);
        return () => clearTimeout(timer);
      } else {
        // Normal flow - navigate after brief delay
        const timer = setTimeout(navigateToRecipe, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [extraction.isComplete, extraction.recipeId, extraction.lowConfidence, extraction.confidenceWarning]);

  // Proceed with extraction (called after duplicate check or when user chooses "Extract Anyway")
  const proceedWithExtraction = async () => {
    if (isPublic && !(await requestPublishing())) {
      setIsPublic(false);
      return;
    }

    try {
      // Determine extraction type BEFORE starting (to prevent UI flicker)
      const trimmedUrl = url.trim().toLowerCase();
      const isWebsiteUrl = !trimmedUrl.includes('tiktok.com') &&
                           !trimmedUrl.includes('youtube.com') &&
                           !trimmedUrl.includes('youtu.be') &&
                           !trimmedUrl.includes('instagram.com');
      setExtractingAsWebsite(isWebsiteUrl);

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
        setIsPublic(false);  // New extractions are private by default
      }
      // Otherwise, polling has started and progress UI will show
    } catch (error: any) {
      Alert.alert(
        'Extraction Failed',
        error.message || 'Something went wrong. Please try again.'
      );
    }
  };

  const cancelCurrentExtraction = async () => {
    try {
      await extraction.cancel();
      return true;
    } catch {
      Alert.alert(
        'Could Not Cancel',
        'We could not reach the server, so the extraction may still be running. We will keep it here and try again when your connection improves.'
      );
      return false;
    }
  };

  const handleExtract = async () => {
    if (!url.trim()) {
      Alert.alert('Missing URL', 'Please paste a video URL to extract a recipe.');
      return;
    }

    // Check if extraction is already in progress
    if (extraction.isExtracting) {
      Alert.alert(
        'Extraction in Progress',
        'An extraction is already running. What would you like to do?',
        [
          { text: 'Keep Current', style: 'cancel' },
          {
            text: 'Start New',
            style: 'destructive',
            onPress: async () => {
              const cancelled = await cancelCurrentExtraction();
              if (!cancelled) return;
              // Small delay to ensure state is reset
              setTimeout(() => handleExtract(), 100);
            }
          },
        ]
      );
      return;
    }

    // Validate URL format
    const urlLower = url.toLowerCase();
    if (!urlLower.includes('tiktok.com') &&
        !urlLower.includes('youtube.com') &&
        !urlLower.includes('youtu.be') &&
        !urlLower.includes('instagram.com')) {
      // For non-video URLs, we still allow them (website extraction)
      // Just make sure it's a valid URL format
      if (!urlLower.startsWith('http://') && !urlLower.startsWith('https://')) {
      Alert.alert(
        'Invalid URL',
          'Please enter a valid URL starting with http:// or https://'
      );
      return;
      }
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
            'Recipe Already Extracted!',
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
      'What would you like to do?',
      [
        { text: 'Keep Waiting', style: 'cancel' },
        {
          text: 'Stop Extraction',
          style: 'destructive',
          onPress: async () => {
            // Cancel the backend job (prevents recipe from being saved)
            const cancelled = await cancelCurrentExtraction();
            if (!cancelled) return;
            setUrl('');
            setExtractingAsWebsite(false);
          }
        },
        {
          text: 'Check Later',
          onPress: () => {
            // Just navigate away - extraction continues in background
            router.push('/history');
          }
        },
      ]
    );
  };

  const handleRetry = () => {
    extraction.reset();
    setExtractingAsWebsite(false);
  };

  /** Recover a failed import as a private, editable source-only recipe. */
  const handleKeepSourceDraft = async () => {
    try {
      const recipeId = await extraction.saveSourceDraft();
      await extraction.reset();
      setUrl('');
      setNotes('');
      setIsPublic(false);
      setExtractingAsWebsite(false);
      router.push(`/recipe/${recipeId}`);
    } catch (error: any) {
      Alert.alert('Could Not Save Draft', error?.message || 'Please try again.');
    }
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
            {selectedImages.map((image, index) => (
              <RNView key={index} style={styles.galleryImageContainer}>
                <Image source={{ uri: image.uri }} style={styles.galleryImage} />
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
              ? 'Add more screenshots or pages for a complete recipe. Source images are not attached to the saved recipe.'
              : `${selectedImages.length} images will be combined in this order. Source images are not attached to the saved recipe.`}
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

  // Show progress UI when extracting.
  // Only show failed state if there's an actual error message (prevents brief flash).
  const showExtractionUI = extraction.isExtracting || (extraction.isFailed && extraction.error);
  if (showExtractionUI) {
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
            terminalStatus={extraction.terminalStatus}
            connectionNotice={extraction.connectionNotice}
            isRetrying={extraction.isRetrying}
            nextAttemptAt={extraction.nextAttemptAt}
            attemptCount={extraction.attemptCount}
            maxAttempts={extraction.maxAttempts}
            isWebsite={extraction.sourceUrl ? extraction.isWebsiteExtraction : extractingAsWebsite}
            lowConfidence={extraction.lowConfidence}
            confidenceWarning={extraction.confidenceWarning}
          />

          {extraction.isFailed ? (
            <>
              {extraction.canSaveDraft && (
                <RNView style={styles.buttonRow}>
                  <Button
                    title="Keep Source as Draft"
                    onPress={handleKeepSourceDraft}
                    size="lg"
                  />
                </RNView>
              )}
              <RNView style={styles.buttonRow}>
                <Button
                  title={extraction.canRetryStart ? 'Reconnect' : 'Start Again'}
                  onPress={extraction.canRetryStart ? extraction.retryPendingStart : handleRetry}
                  variant={extraction.canSaveDraft ? 'secondary' : 'primary'}
                  size="lg"
                />
              </RNView>
            </>
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
            {extraction.isFailed
              ? 'Your recipe URL and options are still here, ready when you are.'
              : 'You can leave this screen — extraction continues in the background'}
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
            {
              paddingBottom: guestPromptBottomPadding(
                Math.max(insets.bottom, 80) + spacing.xl,
                Boolean(isSignedIn),
                guestPromptHeight,
              ),
            }
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Hero Section */}
          <LinearGradient
            colors={[colors.backgroundElevated, colors.backgroundSecondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.heroCard, { borderColor: colors.border }]}
          >
            <RNView style={styles.heroTopRow}>
              <BrandMark size={70} />
              <RNView style={[styles.aiBadge, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.aiBadgeText, { color: colors.accent }]}>AI-ASSISTED</Text>
              </RNView>
            </RNView>
            <Text maxFontSizeMultiplier={1.4} style={[styles.heroEyebrow, { color: colors.tint }]}>AI recipe extraction</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.heroTitle, { color: colors.text }]}>Turn recipe links and text into something you can cook.</Text>
            <Text style={[styles.heroSubtitle, { color: colors.textSecondary }]}>
              Import a social video or website, paste a caption or DM, scan screenshots, or add a family recipe. Håfa Recipes organizes the ingredients, steps, costs, and cook mode for you.
            </Text>
            <RNView style={styles.sourcePills}>
              <RNView style={[styles.sourcePill, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                <Ionicons name="logo-tiktok" size={14} color={colors.tint} />
                <Text maxFontSizeMultiplier={1.4} style={[styles.sourcePillText, { color: colors.textSecondary }]}>TikTok</Text>
              </RNView>
              <RNView style={[styles.sourcePill, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                <Ionicons name="logo-youtube" size={14} color={colors.tint} />
                <Text maxFontSizeMultiplier={1.4} style={[styles.sourcePillText, { color: colors.textSecondary }]}>YouTube</Text>
              </RNView>
              <RNView style={[styles.sourcePill, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                <Ionicons name="logo-instagram" size={14} color={colors.tint} />
                <Text maxFontSizeMultiplier={1.4} style={[styles.sourcePillText, { color: colors.textSecondary }]}>Instagram</Text>
              </RNView>
              <RNView style={[styles.sourcePill, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                <Ionicons name="globe-outline" size={14} color={colors.accent} />
                <Text maxFontSizeMultiplier={1.4} style={[styles.sourcePillText, { color: colors.textSecondary }]}>Websites</Text>
              </RNView>
              <RNView style={[styles.sourcePill, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                <Ionicons name="document-text-outline" size={14} color={colors.accent} />
                <Text maxFontSizeMultiplier={1.4} style={[styles.sourcePillText, { color: colors.textSecondary }]}>Recipe text</Text>
              </RNView>
            </RNView>
          </LinearGradient>

          {/* URL Input - Primary Action */}
          <RNView style={styles.section}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Recipe link
            </Text>
            <Input
              value={url}
              onChangeText={setUrl}
              placeholder="TikTok, Instagram, YouTube, or recipe website link"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
            />
            <RNView style={styles.helpStack}>
              <RNView style={styles.helpRow}>
                <Ionicons name="videocam-outline" size={15} color={colors.tint} />
                <Text style={[styles.hint, { color: colors.textMuted }]}>Videos work best when the recipe is spoken or written in the caption.</Text>
              </RNView>
              <RNView style={styles.helpRow}>
                <Ionicons name="newspaper-outline" size={15} color={colors.accent} />
                <Text style={[styles.hint, { color: colors.textMuted }]}>Recipe websites work with most popular blogs and publishers.</Text>
              </RNView>
              <RNView style={styles.helpRow}>
                <Ionicons name="mail-outline" size={15} color={colors.accent} />
                <Text style={[styles.hint, { color: colors.textMuted }]}>
                  If a website does not import cleanly, email{' '}
                  <Text style={[styles.hintLink, { color: colors.tint }]} onPress={handleWebsiteSupportPress}>
                    shimizutechnology@gmail.com
                  </Text>
                  {' '}so we can tune support for it.
                </Text>
              </RNView>
            </RNView>
            <RNView style={[styles.aiNote, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
              <Ionicons name="sparkles-outline" size={16} color={colors.accent} />
              <Text style={[styles.aiNoteText, { color: colors.textSecondary }]}>
                AI-assisted extraction. Check the ingredients and directions before saving.
              </Text>
            </RNView>
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
            onPress={handlePublicToggle}
            activeOpacity={0.7}
            disabled={!isSignedIn || isLoading || isCheckingDisclosure}
            accessibilityRole="switch"
            accessibilityLabel="Share recipe to the public library"
            accessibilityHint="Off keeps this recipe visible only to you"
            accessibilityState={{ checked: isPublic, disabled: !isSignedIn || isLoading || isCheckingDisclosure }}
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
            <Ionicons
              name={isPublic ? 'checkmark-circle' : 'ellipse-outline'}
              size={26}
              color={isPublic ? colors.tint : colors.textMuted}
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

          {/* Paste Recipe Text Button */}
          <TouchableOpacity
            style={[styles.scanButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
            onPress={() => router.push({
              pathname: '/paste-recipe',
              params: { location: selectedLocation, isPublic: isPublic ? 'true' : 'false' },
            })}
            disabled={!isSignedIn || isLoading}
            activeOpacity={0.7}
          >
            <RNView style={[styles.scanIconContainer, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name="clipboard-outline" size={28} color={colors.accent} />
            </RNView>
            <RNView style={styles.scanTextContainer}>
              <Text style={[styles.scanTitle, { color: colors.text }]}>Paste Recipe Text</Text>
              <Text style={[styles.scanSubtitle, { color: colors.textMuted }]}>Turn a caption, message, or copied recipe into a draft</Text>
            </RNView>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>

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
                Import Screenshots or Photos
              </Text>
              <Text style={[styles.scanSubtitle, { color: colors.textMuted }]}>
                Extract a recipe from screenshots, cards, or cookbook pages
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
              AI-assisted recipe extraction
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
  heroCard: {
    borderWidth: 1,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  heroEyebrow: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  heroTitle: {
    fontSize: fontSize.xxxl,
    fontFamily: fontFamily.display,
    lineHeight: 42,
    marginBottom: spacing.sm,
  },
  aiBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  aiBadgeText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
    letterSpacing: 0.8,
  },
  heroSubtitle: {
    fontSize: fontSize.md,
    lineHeight: 23,
  },
  sourcePills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  sourcePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  sourcePillText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
  },
  section: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    marginBottom: spacing.sm,
  },
  helpStack: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  helpRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  hint: {
    flex: 1,
    fontSize: fontSize.xs,
    lineHeight: 18,
  },
  hintLink: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    textDecorationLine: 'underline',
  },
  aiNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  aiNoteText: {
    flex: 1,
    fontSize: fontSize.xs,
    lineHeight: 18,
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
    borderRadius: radius.xl,
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
    borderRadius: radius.xl,
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
