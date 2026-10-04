import { legacyShareReceipts } from '@/lib/legacyShareReceipts';
import { useState, useEffect, useRef, useCallback } from 'react';
import * as Crypto from 'expo-crypto';
import * as Clipboard from 'expo-clipboard';
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
  Keyboard,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/expo';
import * as ImagePicker from 'expo-image-picker';
import { ShareIntentModule } from 'expo-share-intent';

import { Text, Input, Button, useColors } from '@/components/Themed';
import ExtractionProgress from '@/components/ExtractionProgress';
import { ImportSettingsPanel, ImportHelpPanel } from '@/components/ImportPanels';
import RecipeChatModal from '@/components/RecipeChatModal';
import { SignInBanner } from '@/components/SignInBanner';
import { useExtractionJobs, useLocations, useCheckDuplicate, useSaveCapturedRecipe } from '@/hooks/useRecipes';
import { useAsyncExtraction } from '@/contexts/ExtractionContext';
import { ImportActivityCard } from '@/components/ImportActivityCard';
import { spacing, fontSize, fontWeight, radius, fontFamily } from '@/constants/Colors';
import { api, type RecipeImageUpload } from '@/lib/api';
import { consumePendingShareCapture, stagePendingShareCapture } from '@/lib/shareCapture';
import { importInbox, type ImportInboxEntry } from '@/lib/importInbox';
import { useImportInbox } from '@/hooks/useImportInbox';
import { RecipeVisibilitySelector } from '@/components/RecipeVisibilitySelector';
import { CaptureAccountChangedError, saveCaptureOrRecover } from '@/lib/captureSave';
import { usePublishingDisclosure } from '@/hooks/usePublishingDisclosure';
import {
  getImageImportFailurePresentation,
  getManualImageDraftRoute,
} from '@/lib/imageImportClassification';

export default function ExtractScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isSignedIn, isLoaded: isAuthLoaded } = useAuth();
  const { sharedUrl, sharedReceiptId, captureToken, inboxCaptureId } = useLocalSearchParams<{
    sharedUrl?: string;
    sharedReceiptId?: string;
    captureToken?: string;
    inboxCaptureId?: string;
  }>();

  const handleWebsiteSupportPress = () => {
    Linking.openURL('mailto:shimizutechnology@gmail.com?subject=H%C3%A5fa%20Recipes%20website%20extraction%20issue');
  };

  // All hooks must be called unconditionally
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [panel, setPanel] = useState<'settings' | 'help' | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [hasOpenedChat, setHasOpenedChat] = useState(false);
  useEffect(() => {
    if (!isSignedIn) { setShowChat(false); setHasOpenedChat(false); }
  }, [isSignedIn]);
  const [showProgressDetails, setShowProgressDetails] = useState(false);
  const importScroll = useRef<ScrollView>(null);
  const composerTop = useRef(0);
  const linkFocused = useRef(false);
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      if (linkFocused.current) importScroll.current?.scrollTo({ y: composerTop.current, animated: true });
    });
    return () => subscription.remove();
  }, []);
  const inbox = useImportInbox();
  const captureOwner = useRef({ ownerId: inbox.ownerId, mounted: true });
  captureOwner.current.ownerId = inbox.ownerId;
  useEffect(() => {
    captureOwner.current.mounted = true;
    return () => { captureOwner.current.mounted = false; };
  }, []);
  const [selectedLocation, setSelectedLocation] = useState('Guam');
  const [isPublic, setIsPublic] = useState(true);
  const currentDraft = useRef({ url, notes, isPublic, selectedLocation, ownerId: inbox.ownerId });
  currentDraft.current = { url, notes, isPublic, selectedLocation, ownerId: inbox.ownerId };
  const [isChecking, setIsChecking] = useState(false);
  const imageImportInFlight = useRef(false);
  const [isOcrExtracting, setIsOcrExtracting] = useState(false);
  const [ocrProgress, setOcrProgress] = useState('');
  const [extractingAsWebsite, setExtractingAsWebsite] = useState(false); // Track extraction type to prevent flicker
  const [isSavingSourceDraft, setIsSavingSourceDraft] = useState(false);
  const [selectedImages, setSelectedImages] = useState<RecipeImageUpload[]>([]); // Multi-image support
  const [showImageGallery, setShowImageGallery] = useState(false);
  const [selectedInboxId, setSelectedInboxId] = useState<string | null>(null);
  useEffect(() => {
    imageImportInFlight.current = false;
    setIsOcrExtracting(false); setOcrProgress('');
    setSelectedImages([]); setShowImageGallery(false); setSelectedInboxId(null);
  }, [inbox.ownerId]);
  const [pendingShares, setPendingShares] = useState(0);
  const [isOpeningNextShare, setIsOpeningNextShare] = useState(false);
  const openingNextShare = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !ShareIntentModule) return;
    const subscription = ShareIntentModule.addListener('onQueueChange', ({ pendingCount }) => {
      setPendingShares(pendingCount);
      openingNextShare.current = false;
      setIsOpeningNextShare(false);
    });
    return () => subscription.remove();
  }, []);

  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'ios') return;
    // The incoming share is acknowledged as this screen opens. Check after
    // that acknowledgement so the count reflects only later captures.
    const timer = setTimeout(() => {
      void ShareIntentModule?.getPendingShareCount().then(setPendingShares);
    }, 400);
    return () => clearTimeout(timer);
  }, []));

  const { data: locationsData } = useLocations();
  const extraction = useAsyncExtraction();
  const recentImports = useExtractionJobs('extract', Boolean(isSignedIn));
  const checkDuplicate = useCheckDuplicate();
  const saveCapturedRecipe = useSaveCapturedRecipe();
  const { requestPublishing, isCheckingDisclosure } = usePublishingDisclosure();

  // Route receipt IDs and a session registry survive auth-driven remounts.
  const currentLegacyRoute = useRef({ sharedUrl, sharedReceiptId });
  currentLegacyRoute.current = { sharedUrl, sharedReceiptId };
  const [legacyShareRetryVersion, setLegacyShareRetryVersion] = useState(0);
  useEffect(() => {
    if (!sharedUrl) { legacyShareReceipts.clearRoute(); return; }
    let cancelled = false;
    try {
      const ownerId = isAuthLoaded && isSignedIn ? inbox.ownerId : null;
      const receipt = legacyShareReceipts.receive(sharedUrl, sharedReceiptId, ownerId);
      // Publish the ID before the first awaited storage operation. The session
      // registry covers an auth remount even before router updates are rendered.
      if (!sharedReceiptId) router.setParams({ sharedReceiptId: receipt.id });
      void legacyShareReceipts.persist(receipt, importInbox).then(() => {
        if (!cancelled && captureOwner.current.mounted && legacyShareReceipts.isCurrent(receipt) &&
            currentLegacyRoute.current.sharedUrl === receipt.url) {
          router.setParams({ sharedUrl: undefined, sharedReceiptId: undefined });
        }
      }).catch((error: Error) => {
        if (!cancelled && captureOwner.current.mounted && legacyShareReceipts.isCurrent(receipt)) {
          Alert.alert('Could Not Save Import', error.message, [{ text: 'Retry', onPress: () => {
            if (captureOwner.current.mounted && legacyShareReceipts.isCurrent(receipt)) setLegacyShareRetryVersion((version) => version + 1);
          } }, { text: 'Later', style: 'cancel' }]);
        }
      });
    } catch (error) {
      Alert.alert('Could Not Save Import', error instanceof Error ? error.message : 'Please share this link again.');
    }
    return () => { cancelled = true; };
  }, [router, sharedUrl, sharedReceiptId, inbox.ownerId, isAuthLoaded, isSignedIn, legacyShareRetryVersion]);

  const openCapturedEntry = async (entry: ImportInboxEntry) => {
    if (!inbox.ownerId) { router.push('/(auth)/sign-in'); return; }
    await importInbox.claim(entry.id, inbox.ownerId, entry.request);
    if (entry.capture.kind === 'url') return;
    if (entry.capture.kind === 'text') {
      router.push({ pathname: '/paste-recipe', params: { inboxCaptureId: entry.id } });
    } else {
      setSelectedInboxId(entry.id);
      setIsPublic(false);
      const captureToken = stagePendingShareCapture(entry.capture);
      router.setParams({ captureToken });
    }
  };

  // Image/text intake is a user-reviewed flow. Keep the persisted record until
  // the user explicitly opens it; URL captures auto-submit independently.
  useEffect(() => {
    if (!inboxCaptureId) return;
    router.setParams({ inboxCaptureId: undefined });
  }, [inboxCaptureId, router]);

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
    if (selectedImages.length === 0 || imageImportInFlight.current || isCheckingDisclosure) return;
    const originalOwner = inbox.ownerId;
    if (!originalOwner) { Alert.alert('Sign In to Import', 'Please sign in and wait for your recipe library to load.'); return; }
    const guardOwner = () => {
      if (!captureOwner.current.mounted || captureOwner.current.ownerId !== originalOwner) throw new CaptureAccountChangedError();
    };
    imageImportInFlight.current = true;
    if (isPublic) {
      const allowed = await requestPublishing();
      if (!captureOwner.current.mounted || captureOwner.current.ownerId !== originalOwner) return;
      if (!allowed) { imageImportInFlight.current = false; setIsPublic(false); return; }
    }
    if (!captureOwner.current.mounted || captureOwner.current.ownerId !== originalOwner) return;

    setIsOcrExtracting(true);
    setShowImageGallery(false);

    const imageCount = selectedImages.length;
    setOcrProgress(`Analyzing ${imageCount} image${imageCount > 1 ? 's' : ''}...`);

    try {
      setOcrProgress(`Extracting recipe with AI vision...`);

      guardOwner();
      // Use single or multi-image API based on count
      const result = imageCount === 1
        ? await api.extractRecipeFromImage(selectedImages[0], selectedLocation)
        : await api.extractRecipeFromMultipleImages(selectedImages, selectedLocation);

      guardOwner();
      if (result.success && result.recipe) {
        setOcrProgress('Saving recipe...');
        const destination = await saveCaptureOrRecover({
          extracted: result.recipe,
          source_type: 'photo',
          is_public: isPublic,
          capture_id: selectedInboxId ?? undefined,
          expected_owner_id: originalOwner, requestGuard: guardOwner,
        }, selectedLocation, saveCapturedRecipe.mutateAsync);
        guardOwner();
        if (selectedInboxId && typeof destination === 'string') {
          await importInbox.patch(selectedInboxId, { state: 'accepted', recipeId: destination.split('/').pop() });
          guardOwner();
          setSelectedInboxId(null);
        }
        guardOwner();
        setSelectedImages([]);
        router.push(destination);
      } else {
        const failure = getImageImportFailurePresentation(result);
        Alert.alert(failure.title, failure.message, failure.offersManualEntry
          ? [
              {
                text: 'Use Image & Enter Manually',
                onPress: () => {
                  try { guardOwner(); } catch { return; }
                  const draftRoute = getManualImageDraftRoute(selectedImages[0]?.uri);
                  if (!draftRoute) return;
                  // Keep every selected source on Import so multi-page recovery
                  // remains available if the user returns from the manual draft.
                  router.push(draftRoute);
                },
              },
              { text: 'Review Images', style: 'cancel' },
            ]
          : [{ text: 'OK' }]);
        setShowImageGallery(true); // Show gallery again to retry
      }
    } catch (error: any) {
      if (error instanceof CaptureAccountChangedError || !captureOwner.current.mounted || captureOwner.current.ownerId !== originalOwner) return;
      // User-facing alert is sufficient
      Alert.alert(
        'Extraction Failed',
        error.message || 'Something went wrong. Please try again.'
      );
      setShowImageGallery(true); // Show gallery again to retry
    } finally {
      if (captureOwner.current.ownerId === originalOwner) imageImportInFlight.current = false;
      if (captureOwner.current.mounted && captureOwner.current.ownerId === originalOwner) {
        setIsOcrExtracting(false);
        setOcrProgress('');
      }
    }
  };

  const clearCompletedExtraction = async () => {
    await extraction.reset();
    setExtractingAsWebsite(false);
  };

  const handleReviewCompletedRecipe = async () => {
    if (!extraction.recipeId) return;
    const recipeId = extraction.recipeId;
    await clearCompletedExtraction();
    router.push(`/recipe/${recipeId}`);
  };

  // Proceed with extraction (called after duplicate check or when user chooses "Extract Anyway")
  const proceedWithExtraction = async () => {
    const draft = { url, notes, isPublic, selectedLocation, ownerId: inbox.ownerId };
    if (currentDraft.current.ownerId !== draft.ownerId) return;
    if (isPublic && !(await requestPublishing())) {
      if (JSON.stringify(currentDraft.current) === JSON.stringify(draft)) setIsPublic(false);
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

      if (!inbox.ownerId) throw new Error('Please wait while we verify your recipe library.');
      if (currentDraft.current.ownerId !== draft.ownerId) throw new Error('Your account changed. Please try importing again.');
      const importUrl = draft.url.trim();
      await importInbox.add({
        id: Crypto.randomUUID(), ownerId: inbox.ownerId,
        capture: { kind: 'url', url: importUrl }, createdAt: Date.now(), state: 'ready',
        request: { url: importUrl, location: selectedLocation, notes: notes.trim(), is_public: isPublic },
      });
      if (JSON.stringify(currentDraft.current) === JSON.stringify(draft)) {
        setUrl('');
        setNotes('');
      }

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
      const duplicate = await checkDuplicate.mutateAsync(url.trim());

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

  const handleRetry = async () => {
    if (!inbox.ownerId || !extraction.sourceUrl || extraction.jobKind !== 'extract') return;
    await importInbox.add({
      id: Crypto.randomUUID(), ownerId: inbox.ownerId, createdAt: Date.now(), state: 'ready',
      capture: { kind: 'url', url: extraction.sourceUrl },
      request: { url: extraction.sourceUrl, location: extraction.sourceLocation || 'Guam',
        notes: extraction.sourceNotes, is_public: extraction.requestedIsPublic },
    });
  };

  /** Recover a failed import as a private, editable source-only recipe. */
  const handleKeepSourceDraft = async () => {
    if (isSavingSourceDraft) return;
    setIsSavingSourceDraft(true);
    try {
      const recipeId = await extraction.saveSourceDraft();
      await extraction.reset();
      setExtractingAsWebsite(false);
      router.push(`/recipe/${recipeId}`);
    } catch (error: any) {
      Alert.alert('Could Not Save Draft', error?.message || 'Please try again.');
    } finally {
      setIsSavingSourceDraft(false);
    }
  };

  const isLoading = isChecking || isOcrExtracting || isSavingSourceDraft;
  const isPreparingImports = Boolean(isSignedIn && extraction.isPreparing);

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

          <RecipeVisibilitySelector
            compact
            value={isPublic ? 'public' : 'private'}
            onChange={(value) => setIsPublic(value === 'public')}
            disabled={!isSignedIn || isLoading || isCheckingDisclosure}
          />

          <RNView style={[styles.galleryBottomBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
            <Button title={`Import Recipe from ${selectedImages.length} ${selectedImages.length === 1 ? 'Image' : 'Images'}`}
              onPress={extractFromImages} disabled={!isSignedIn || isLoading || isCheckingDisclosure} size="lg" />
          </RNView>
        </RNView>
      </RNView>
    );
  }

  return (
    <RNView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={insets.top + 64}>
        <ScrollView ref={importScroll} contentContainerStyle={[styles.scrollContent, { paddingBottom: spacing.md }]}
          keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <RNView style={styles.importHeading}>
            <Text style={[styles.importTitle, { color: colors.text }]}>Import a recipe</Text>
            <Text style={[styles.heroSubtitle, { color: colors.textSecondary }]}>Save a recipe from a link, text, or photo.</Text>
          </RNView>
          {pendingShares > 0 && <RNView style={[styles.pendingShareNotice, { borderColor: colors.border }]}>
            <Text style={{ color: colors.text }}>{pendingShares} shared {pendingShares === 1 ? 'recipe' : 'recipes'} ready to sync</Text>
            <TouchableOpacity disabled={isOpeningNextShare} onPress={() => {
              if (!ShareIntentModule || openingNextShare.current) return;
              openingNextShare.current = true;
              setIsOpeningNextShare(true);
              void Promise.resolve(ShareIntentModule.getShareIntent('')).catch(() => {
                openingNextShare.current = false;
                setIsOpeningNextShare(false);
              });
            }} accessibilityRole="button" accessibilityLabel="Open next shared recipe">
              <Text style={{ color: colors.tint }}>Open next</Text>
            </TouchableOpacity>
          </RNView>}
          <RNView onLayout={(event) => { composerTop.current = event.nativeEvent.layout.y; }}
            style={[styles.linkComposer, { borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}>
            <RNView style={styles.composerLabelRow}>
              <Text style={[styles.composerLabel, { color: colors.text }]}>Recipe link</Text>
              <TouchableOpacity style={styles.textAction} disabled={isLoading} accessibilityRole="button"
                accessibilityLabel="Paste recipe link" onPress={() => {
                  const draft = currentDraft.current;
                  void Clipboard.getStringAsync().then((value) => {
                    if (!captureOwner.current.mounted || currentDraft.current.ownerId !== draft.ownerId || currentDraft.current.url !== draft.url) return;
                    if (value.trim()) setUrl(value.trim());
                    else Alert.alert('Nothing to Paste', 'Copy a recipe link first, then paste it here.');
                  }).catch(() => {
                    if (captureOwner.current.mounted && currentDraft.current.ownerId === draft.ownerId)
                      Alert.alert('Could Not Paste', 'Try pasting directly into the recipe link field.');
                  });
                }}>
                <Ionicons name="clipboard-outline" size={16} color={colors.tint} />
                <Text style={[styles.smallActionText, { color: colors.text }]}>Paste</Text>
              </TouchableOpacity>
            </RNView>
            <Input accessibilityLabel="Recipe link" value={url} onChangeText={setUrl}
              placeholder="Paste a recipe link" keyboardType="url" returnKeyType="done"
              autoCapitalize="none" autoCorrect={false} editable={!isLoading}
              onFocus={() => {
                linkFocused.current = true;
                if (Keyboard.isVisible()) importScroll.current?.scrollTo({ y: composerTop.current, animated: true });
              }}
              onBlur={() => { linkFocused.current = false; }}
              style={{ backgroundColor: colors.background }} />
            <Text style={[styles.supportedSources, { color: colors.textMuted }]}>TikTok, Instagram, YouTube & recipe websites</Text>
            <TouchableOpacity style={styles.settingsSummary} onPress={() => { Keyboard.dismiss(); setPanel('settings'); }}
              disabled={isLoading || isCheckingDisclosure} accessibilityRole="button" accessibilityLabel="Import settings"
              accessibilityHint={`${isPublic ? 'Public in Discover. Anyone can find this recipe.' : 'Private. Only you can open this recipe.'} Cost estimates for ${selectedLocation}.${notes.trim() ? ' Personal notes added.' : ''}`}>
              <Ionicons name={isPublic ? 'globe-outline' : 'lock-closed-outline'} size={20} color={colors.tint} />
              <RNView style={styles.settingsCopy}>
                <Text style={[styles.settingsTitle, { color: colors.text }]}>{isPublic ? 'Public in Discover' : 'Private recipe'}</Text>
                <Text style={[styles.hint, { color: colors.textMuted }]}>{isPublic ? 'Visible to everyone' : 'Only you'} · {selectedLocation}{notes.trim() ? ' · Notes added' : ''}</Text>
              </RNView>
              <Ionicons name="options-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            <Button title={!isSignedIn ? 'Sign In to Import' : isPreparingImports ? 'Preparing Imports...' : isChecking ? 'Checking...' : extraction.isExtracting ? 'Add to Queue' : 'Import Recipe'}
              onPress={!isSignedIn ? () => router.push('/(auth)/sign-in') : () => { Keyboard.dismiss(); return handleExtract(); }}
              disabled={Boolean(isSignedIn) && (isPreparingImports || isLoading || isCheckingDisclosure || !url.trim())}
              loading={isChecking} size="md" />
          </RNView>

          {(extraction.isExtracting || extraction.isComplete || extraction.isFailed) && (
            <RNView style={[styles.compactProgress, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
              <RNView style={styles.pendingShareCopy}>
                {extraction.isExtracting ? <ActivityIndicator color={colors.tint} /> : <Ionicons
                  name={extraction.isFailed ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={22} color={extraction.isFailed ? colors.error : colors.tint} />}
                <RNView style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontFamily: fontFamily.semibold }}>
                    {extraction.isExtracting ? `Importing · ${extraction.progress}%` : extraction.isFailed ? 'Import needs attention' : 'Recipe saved'}
                  </Text>
                  <Text style={[styles.hint, { color: colors.textMuted }]} numberOfLines={2}>
                    {extraction.connectionNotice || extraction.error || extraction.message || 'You can add another recipe while this finishes.'}
                  </Text>
                </RNView>
                <TouchableOpacity onPress={() => setShowProgressDetails(!showProgressDetails)} accessibilityRole="button" accessibilityLabel="Import details" accessibilityState={{ expanded: showProgressDetails }}>
                  <Ionicons name={showProgressDetails ? 'chevron-up' : 'chevron-down'} size={20} color={colors.tint} />
                </TouchableOpacity>
              </RNView>

              {showProgressDetails && <RNView>          <ExtractionProgress
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

</RNView>}
          {extraction.isComplete && extraction.recipeId ? (
            <>
              <RNView style={styles.buttonRow}>
                <Button
                  title="Open Recipe"
                  onPress={handleReviewCompletedRecipe}
                  size="lg"
                />
              </RNView>
              <RNView style={styles.buttonRow}>
                <Button
                  title="Import Another"
                  onPress={clearCompletedExtraction}
                  variant="secondary"
                  size="lg"
                />
              </RNView>
            </>
          ) : extraction.isFailed ? (
            <>
              {extraction.canSaveDraft && (
                <RNView style={styles.buttonRow}>
                  <Button
                    title="Keep Source as Draft"
                    onPress={handleKeepSourceDraft}
                    loading={isSavingSourceDraft}
                    disabled={isSavingSourceDraft}
                    size="lg"
                  />
                </RNView>
              )}
              <RNView style={styles.buttonRow}>
                <Button
                  title={extraction.canRetryStart ? 'Reconnect' : 'Retry Import'}
                  onPress={extraction.canRetryStart ? extraction.retryPendingStart : handleRetry}
                  disabled={isSavingSourceDraft}
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


            </RNView>
          )}

          {inbox.storageError && <Text style={{ color: colors.error }}>{inbox.storageError}</Text>}
          {inbox.entries.length > 0 && <RNView style={[styles.compactProgress, { borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.text }]}>Waiting imports · {inbox.entries.length}</Text>
            {inbox.entries.map((entry) => <RNView key={entry.id} style={styles.inboxRow}>
              <RNView style={{ flex: 1 }}>
                <Text style={{ color: colors.text }} numberOfLines={1}>{entry.capture.kind === 'url' ? entry.capture.url : entry.capture.kind === 'text' ? 'Shared recipe text' : `${entry.capture.images.length} recipe images`}</Text>
                <Text style={[styles.hint, { color: entry.error ? colors.error : colors.textMuted }]}>
                  {entry.error || (entry.ownerId === null ? 'Choose an account to finish importing' : entry.state === 'submitting' ? 'Starting import…' : entry.state === 'ready' ? 'Queued · starts after the current import' : 'Ready to review')}
                </Text>
              </RNView>
              {(entry.state === 'waiting' || entry.state === 'error' || entry.ownerId === null) && <TouchableOpacity onPress={() => {
                void openCapturedEntry(entry).catch((error: Error) => Alert.alert('Could Not Open Import', error.message));
              }} accessibilityRole="button" accessibilityLabel="Finish shared import"><Text style={{ color: colors.tint }}>{entry.state === 'error' ? 'Retry' : 'Finish'}</Text></TouchableOpacity>}
              {entry.state !== 'submitting' && <TouchableOpacity onPress={() => { void importInbox.remove(entry.id).catch((error: Error) => Alert.alert('Could Not Remove Import', error.message)); }} accessibilityRole="button" accessibilityLabel="Remove waiting import"><Ionicons name="close" size={18} color={colors.textMuted} /></TouchableOpacity>}
            </RNView>)}
          </RNView>}

          {isSignedIn && <ImportActivityCard jobs={(recentImports.data || []).filter((job) => !(job.id === extraction.jobId && (extraction.isExtracting || extraction.isComplete || extraction.isFailed)))}
            onOpenRecipe={(job) => { if (job.recipe_id) router.push(`/recipe/${job.recipe_id}`); }}
            onRestore={extraction.restoreJob} />}
          <Text style={[styles.otherWaysLabel, { color: colors.textMuted }]}>OTHER WAYS TO ADD</Text>
          <RNView style={[styles.alternateMethods, { borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}>
            {([
              { title: 'Paste recipe text', icon: 'clipboard-outline', onPress: () => router.push({ pathname: '/paste-recipe', params: { location: selectedLocation, isPublic: isPublic ? 'true' : 'false' } }) },
              { title: 'Scan photos or screenshots', icon: 'camera-outline', onPress: handleScanRecipe },
              { title: 'Write your own recipe', icon: 'create-outline', onPress: () => router.push({ pathname: '/add-recipe', params: { isPublic: isPublic ? 'true' : 'false' } }) },
            ] as const).map((method, index) => (
              <TouchableOpacity key={method.title} accessibilityRole="button" accessibilityLabel={method.title}
                onPress={method.onPress} disabled={!isSignedIn || isLoading} activeOpacity={0.7}
                style={[styles.alternateRow, index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                <Ionicons name={method.icon} size={21} color={colors.tint} />
                <Text style={[styles.alternateTitle, { color: colors.text }]}>{method.title}</Text>
                <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </RNView>
          <RNView style={styles.helpActions}>
            <TouchableOpacity style={styles.textAction} onPress={() => { Keyboard.dismiss(); setPanel('help'); }}
              accessibilityRole="button" accessibilityLabel="Import help">
              <Ionicons name="help-circle-outline" size={18} color={colors.textMuted} />
              <Text style={[styles.smallActionText, { color: colors.textSecondary }]}>Import help</Text>
            </TouchableOpacity>
            {isSignedIn && <TouchableOpacity style={styles.textAction} accessibilityRole="button" accessibilityLabel="Ask Håfa"
              onPress={() => { Keyboard.dismiss(); setHasOpenedChat(true); setShowChat(true); }}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.tint} />
              <Text style={[styles.smallActionText, { color: colors.text }]}>Ask Håfa</Text>
            </TouchableOpacity>}
          </RNView>
        </ScrollView>

        {!isSignedIn && <SignInBanner message="Sign in to extract recipes" />}
      </KeyboardAvoidingView>
      <ImportSettingsPanel visible={panel === 'settings'} onClose={() => setPanel(null)}
        isPublic={isPublic} onVisibilityChange={setIsPublic} location={selectedLocation}
        locations={locationsData?.locations || []} onLocationChange={setSelectedLocation}
        notes={notes} onNotesChange={setNotes} disabled={isLoading || isCheckingDisclosure} />
      <ImportHelpPanel visible={panel === 'help'} onClose={() => setPanel(null)} onWebsiteSupport={handleWebsiteSupportPress} />
      {isSignedIn && hasOpenedChat && <RecipeChatModal isVisible={showChat} onClose={() => setShowChat(false)} />}
    </RNView>
  );
}

const styles = StyleSheet.create({
  linkComposer: { padding: spacing.md, borderWidth: 1, borderRadius: radius.lg, marginBottom: spacing.lg, gap: spacing.sm },
  composerLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  composerLabel: { fontSize: fontSize.md, fontFamily: fontFamily.semibold },
  textAction: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.xs },
  smallActionText: { fontSize: fontSize.sm, fontFamily: fontFamily.medium },
  supportedSources: { fontSize: fontSize.xs, lineHeight: 18 },
  settingsSummary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, minHeight: 56 },
  settingsCopy: { flex: 1 },
  settingsTitle: { fontSize: fontSize.sm, fontFamily: fontFamily.medium },
  otherWaysLabel: { fontSize: fontSize.xs, fontFamily: fontFamily.semibold, letterSpacing: 1, marginBottom: spacing.sm },
  alternateMethods: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.md },
  alternateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, minHeight: 56 },
  alternateTitle: { flex: 1, fontSize: fontSize.md },
  helpActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
  compactProgress: { padding: spacing.md, borderWidth: 1, borderRadius: radius.md, marginBottom: spacing.md, gap: spacing.sm },
  inboxRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingVertical: spacing.sm },
  pendingShareNotice: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  pendingShareCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
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
  importHeading: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  importTitle: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.xxl,
    lineHeight: 34,
  },
  heroSubtitle: {
    fontSize: fontSize.md,
    lineHeight: 23,
  },
  label: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: fontSize.xs,
    lineHeight: 18,
  },
  buttonRow: {
    marginTop: spacing.md,
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
