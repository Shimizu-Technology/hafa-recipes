import { useRecipeOwnerGeneration } from '@/hooks/useOfflineLease';
import { usePrivateRecipeDraft } from '@/hooks/usePrivateRecipeDraft';
import { RecipeDraftNotice } from '@/components/RecipeDraftNotice';
import { privateRecipeDrafts, preserveDraftImage } from '@/lib/privateRecipeDrafts';
import { legacyShareReceipts } from '@/lib/legacyShareReceipts';
import { useState, useEffect, useRef, useCallback } from 'react';
import * as Crypto from 'expo-crypto';
import * as Clipboard from 'expo-clipboard';
import {
  StyleSheet,
  useWindowDimensions,
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

import { IconButton, Text, Input, Button, useColors } from '@/components/Themed';
import ExtractionProgress from '@/components/ExtractionProgress';
import { ImportSettingsPanel, ImportHelpPanel } from '@/components/ImportPanels';
import RecipeChatModal from '@/components/RecipeChatModal';
import { SignInBanner } from '@/components/SignInBanner';
import { useExtractionJobs, useLocations, useCheckDuplicate, useSaveCapturedRecipe, useRecipe } from '@/hooks/useRecipes';
import { useImportPreferences } from '@/hooks/useImportPreferences';
import { getImportStatusPresentation } from '@/lib/importStatusPresentation';
import { useAsyncExtraction } from '@/contexts/ExtractionContext';
import { ImportActivityCard, importSourceLabel, importSourceDetail } from '@/components/ImportActivityCard';
import { spacing, fontSize, fontWeight, radius, fontFamily } from '@/constants/Colors';
import type { JobStatus } from '@/types/recipe';
import { api, type RecipeImageUpload } from '@/lib/api';
import { consumePendingShareCapture, stagePendingShareCapture } from '@/lib/shareCapture';
import { importInbox, type ImportInboxEntry } from '@/lib/importInbox';
import { useImportInbox } from '@/hooks/useImportInbox';
import { RecipeVisibilitySelector } from '@/components/RecipeVisibilitySelector';
import { CaptureAccountChangedError, saveCaptureOrRecover } from '@/lib/captureSave';
import { usePublishingDisclosure } from '@/hooks/usePublishingDisclosure';
import {
  getImageImportFailurePresentation,
} from '@/lib/imageImportClassification';

export default function ExtractScreen() {
  const generation = useRecipeOwnerGeneration();
  return <ExtractScreenContent key={generation} />;
}

function ExtractScreenContent() {
  const router = useRouter();
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { isSignedIn, isLoaded: isAuthLoaded } = useAuth();
  const { sharedUrl, sharedReceiptId, captureToken, inboxCaptureId, entry } = useLocalSearchParams<{
    entry?: 'scan' | 'photos';
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
  const preferences = useImportPreferences(inbox.ownerId);
  const latestPreferences = useRef(preferences);
  latestPreferences.current = preferences;
  const captureOwner = useRef({ ownerId: inbox.ownerId, mounted: true });
  captureOwner.current.ownerId = inbox.ownerId;
  useEffect(() => {
    captureOwner.current.mounted = true;
    return () => { captureOwner.current.mounted = false; };
  }, []);
  const [selectedLocation, setSelectedLocation] = useState('Guam');
  const [isPublic, setIsPublic] = useState(true);
  const initializedPreferencesOwner = useRef<string | null>(null);
  useEffect(() => {
    if (preferences.ready && initializedPreferencesOwner.current !== inbox.ownerId) {
      initializedPreferencesOwner.current = inbox.ownerId;
      setIsPublic(preferences.isPublic); setSelectedLocation(preferences.location);
      setUrl(''); setNotes('');
    }
    if (!inbox.ownerId) initializedPreferencesOwner.current = null;
  }, [inbox.ownerId, preferences.ready, preferences.isPublic, preferences.location]);
  const rememberImportSettings = (patch: { isPublic?: boolean; location?: string }) => {
    void preferences.update(patch).catch(() => Alert.alert('Could not save import settings', 'Your choice applies to this recipe. Please try again to update sharing from other apps.'));
  };
  const restoreComposerPreferences = () => {
    const latest = latestPreferences.current;
    initializedPreferencesOwner.current = latest.ready ? captureOwner.current.ownerId : null;
    setIsPublic(latest.isPublic); setSelectedLocation(latest.location);
  };
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
  const scanDraft = usePrivateRecipeDraft(inbox.ownerId, 'scan', { selectedImages, isPublic, selectedLocation, selectedInboxId }, selectedImages.length > 0, saved => {
    setSelectedImages(saved.selectedImages); setIsPublic(saved.isPublic); setSelectedLocation(saved.selectedLocation);
    setSelectedInboxId(saved.selectedInboxId); setShowImageGallery(true);
  });
  const recoveryDraft = usePrivateRecipeDraft<any>(inbox.ownerId, 'recovery', null, false, saved => {
    if (!saved?.recipe || !saved.captureId) return;
    const savedRecipe = saved.request ? { ...saved.recipe, extracted: saved.request.extracted, source_type: saved.request.source_type, is_public: saved.request.is_public } : saved.recipe;
    router.push(saved.failure && saved.failure.kind !== 'invalid' ? {
      pathname: '/ocr-review', params: { recipe: JSON.stringify(savedRecipe.extracted), captureId: saved.captureId,
        originalPages: JSON.stringify(saved.request?.original_pages || saved.originalPages || []), captureOwnerId: inbox.ownerId!, sourceType: savedRecipe.source_type, isPublic: savedRecipe.is_public ? 'true' : 'false',
        saveFailed: 'true', saveErrorKind: saved.failure.kind, saveErrorMessage: saved.failure.message, savedRecipeId: saved.failure.savedRecipeId || '' },
    } : { pathname: '/edit-capture', params: { initialData: JSON.stringify(savedRecipe.extracted), captureId: saved.captureId,
      originalPages: JSON.stringify(saved.request?.original_pages || saved.originalPages || []), captureOwnerId: inbox.ownerId!, captureSource: savedRecipe.source_type, isPublic: savedRecipe.is_public ? 'true' : 'false', resumeDraft: 'true' } });
  });
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
  const completedRecipe = useRecipe(extraction.recipeId || '', Boolean(isSignedIn && extraction.isComplete && extraction.recipeId));
  const importStatus = getImportStatusPresentation(extraction, completedRecipe.data);
  useEffect(() => { setShowProgressDetails(false); }, [extraction.jobId]);
  const recentImports = useExtractionJobs('extract', Boolean(isSignedIn));
  const checkDuplicate = useCheckDuplicate();
  const saveCapturedRecipe = useSaveCapturedRecipe();
  const { requestPublishing, isCheckingDisclosure, didChoosePrivate } = usePublishingDisclosure();

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
    if (!inbox.ownerId) {
      if (!isSignedIn) router.push('/(auth)/sign-in');
      return;
    }
    const owner = inbox.ownerId;
    if (entry.submissionClaimed || entry.state === 'submitting') {
      if (!(extraction.canRetryStart && extraction.requestKey === `share:${entry.id}`)) {
        await extraction.recoverImport(entry);
      }
      if (!captureOwner.current.mounted || captureOwner.current.ownerId !== owner) return;
      await extraction.retryPendingStart();
      return;
    }
    if (entry.capture.kind === 'url' && entry.request?.is_public) {
      const allowed = await requestPublishing();
      if (!captureOwner.current.mounted || captureOwner.current.ownerId !== owner) return;
      if (!allowed) {
        if (didChoosePrivate()) await importInbox.patch(entry.id, { request: { ...entry.request, is_public: false },
          preferences: { isPublic: false, location: entry.request.location || 'Guam' }, state: 'waiting',
          error: 'Set to private. Tap Finish to import.' });
        return;
      }
    }
    await importInbox.claim(entry.id, owner, entry.request);
    if (!captureOwner.current.mounted || captureOwner.current.ownerId !== owner) return;
    if (entry.capture.kind === 'url') return;
    if (entry.capture.kind === 'text') {
      router.push({ pathname: '/paste-recipe', params: { inboxCaptureId: entry.id } });
    } else {
      initializedPreferencesOwner.current = owner;
      setSelectedInboxId(entry.id);
      setIsPublic(entry.preferences?.isPublic ?? false);
      setSelectedLocation(entry.preferences?.location || 'Guam');
      const captureToken = stagePendingShareCapture(entry.capture, owner);
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
      'Håfa keeps your original pages privately so you can check them later. You can remove them anytime.\n\nTake a photo or choose up to 10 screenshots, recipe cards, or cookbook pages.',
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
    const imageOwner = inbox.ownerId;
    if (!imageOwner) return;
    const lease = privateRecipeDrafts.lease(imageOwner);
    if (await privateRecipeDrafts.read(lease, 'recovery')) {
      Alert.alert('Finish or discard your previous scan', 'Use Resume draft or Discard draft below before selecting new pages.');
      return;
    }
    const guard = () => {
      if (!captureOwner.current.mounted || captureOwner.current.ownerId !== imageOwner) throw new CaptureAccountChangedError();
      privateRecipeDrafts.assert(lease);
    };
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
      guard();
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
        guard();
        const newImages = await Promise.all(result.assets.map(async (asset) => ({ uri: await preserveDraftImage(lease, asset.uri, guard) })));
        guard();
        if (captureOwner.current.ownerId !== imageOwner) return;
        const allImages = [...selectedImages, ...newImages].slice(0, 10); // Max 10 images
        setSelectedImages(allImages);
        setShowImageGallery(true);
      }
    } catch {
      // User-facing alert is sufficient
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const openedEntry = useRef<string | null>(null);
  useEffect(() => {
    if (!entry) { openedEntry.current = null; return; }
    if (!isAuthLoaded || !isSignedIn || !inbox.ownerId || openedEntry.current === entry) return;
    openedEntry.current = entry;
    router.setParams({ entry: undefined });
    void pickImage(entry === 'scan' ? 'camera' : 'library');
  }, [entry, isAuthLoaded, isSignedIn, inbox.ownerId]);


  const moveImage = (index: number, direction: -1 | 1) => setSelectedImages((pages) => {
    const next = index + direction;
    if (next < 0 || next >= pages.length) return pages;
    const ordered = [...pages];
    [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    return ordered;
  });
  const removeImage = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  const clearImages = () => {
    Alert.alert('Discard scan draft?', 'These selected pages will be removed from this draft.', [
      { text: 'Keep draft', style: 'cancel', onPress: () => { void scanDraft.flush().then(() => { scanDraft.pause(); setShowImageGallery(false); }); } },
      { text: 'Discard', style: 'destructive', onPress: () => { void scanDraft.finish().then(() => { setSelectedImages([]); setShowImageGallery(false); setSelectedInboxId(null); restoreComposerPreferences(); }); } },
    ]);

  };

  const extractFromImages = async () => {
    if (recoveryDraft.available) { Alert.alert('Finish your saved draft', 'Resume or discard the recipe recovery before starting another scan.'); return; }
    if (!scanDraft.ready || scanDraft.available || selectedImages.length === 0 || imageImportInFlight.current || isCheckingDisclosure) return;
    const originalOwner = inbox.ownerId;
    if (!originalOwner) { Alert.alert('Sign In to Import', 'Please sign in and wait for your recipe library to load.'); return; }
    const guardOwner = () => {
      if (!captureOwner.current.mounted || captureOwner.current.ownerId !== originalOwner) throw new CaptureAccountChangedError();
    };
    imageImportInFlight.current = true;
    let requestedPublic = isPublic;
    if (requestedPublic) {
      const allowed = await requestPublishing();
      if (!captureOwner.current.mounted || captureOwner.current.ownerId !== originalOwner) return;
      if (!allowed) {
        if (!didChoosePrivate()) { imageImportInFlight.current = false; return; }
        requestedPublic = false;
        setIsPublic(false);
      }
    }
    if (!captureOwner.current.mounted || captureOwner.current.ownerId !== originalOwner) return;

    setIsOcrExtracting(true);
    setShowImageGallery(false);

    const imageCount = selectedImages.length;
    setOcrProgress(`Analyzing ${imageCount} image${imageCount > 1 ? 's' : ''}...`);

    try {
      setOcrProgress(`Extracting recipe with AI vision...`);

      guardOwner();
      await scanDraft.flush();
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
          original_pages: selectedImages,
          is_public: requestedPublic,
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
        if (typeof destination === 'string') await scanDraft.finish();
        guardOwner();
        setSelectedImages([]);
        restoreComposerPreferences();
        router.push(destination);
      } else {
        const failure = getImageImportFailurePresentation(result);
        Alert.alert(failure.title, failure.message, failure.offersManualEntry
          ? [
              {
                text: 'Use Image & Enter Manually',
                onPress: () => {
                  try { guardOwner(); } catch { return; }
                  router.push({ pathname: '/edit-capture', params: {
                    initialData: JSON.stringify({ title: '', components: [{ name: 'Main', ingredients: [], steps: [] }] }),
                    captureId: selectedInboxId ?? Crypto.randomUUID(), captureOwnerId: originalOwner,
                    captureSource: 'photo', isPublic: 'false', originalPages: JSON.stringify(selectedImages),
                  } });
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
    let requestedPublic = draft.isPublic;
    if (requestedPublic && !(await requestPublishing())) {
      if (!didChoosePrivate() || JSON.stringify(currentDraft.current) !== JSON.stringify(draft)) return;
      requestedPublic = false;
      setIsPublic(false);
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
        request: { url: importUrl, location: selectedLocation, notes: notes.trim(), is_public: requestedPublic },
      });
      if (JSON.stringify({ ...currentDraft.current, isPublic: draft.isPublic }) === JSON.stringify(draft)) {
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

  const handleCancel = (job?: JobStatus) => {
    const targetId = job?.id ?? extraction.jobId;
    const originalOwner = inbox.ownerId;
    if (!targetId) return;
    const remove = job ? job.status === 'failed' || job.status === 'expired' : extraction.isFailed;
    const label = remove ? 'Remove unfinished import' : 'Cancel import';
    Alert.alert(
      `${label}?`,
      remove ? 'Remove this attempt from Unfinished imports? Any saved recipes will stay in your library.'
        : 'Stop this import? Any recipes already saved will stay in your library.',
      [
        { text: 'Keep import', style: 'cancel' },
        { text: label, style: 'destructive', onPress: async () => {
          if (captureOwner.current.ownerId !== originalOwner) return;
          try {
            await extraction.cancel(targetId);
            if (captureOwner.current.ownerId === originalOwner && targetId === extraction.jobId) setExtractingAsWebsite(false);
          } catch (error: any) {
            if (captureOwner.current.ownerId !== originalOwner) return;
            Alert.alert('Could Not Remove Import', error?.message || 'We could not reach the server. This import is still here so you can try again.');
          }
        } },
      ],
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
            <Ionicons name="scan" size={48} color={colors.actionText} />
            <Text style={[styles.ocrProgressTitle, { color: colors.text }]}>
              Scanning Recipe
            </Text>
            <Text style={[styles.ocrProgressMessage, { color: colors.textSecondary }]}>
              {ocrProgress}
            </Text>
            <ActivityIndicator size="large" color={colors.actionText} style={styles.ocrSpinner} />
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
              <RNView key={image.uri} style={{ width: fontScale >= 1.3 ? '100%' : '45%', minWidth: 140, flexGrow: 1 }}>
              <RNView style={[styles.galleryImageContainer, { width: '100%' }]}>
                <Image source={{ uri: image.uri }} style={styles.galleryImage} />
                <IconButton
                  icon="close-circle"
                  accessibilityLabel={`Remove page ${index + 1}`}
                  onPress={() => removeImage(index)}
                  color={colors.text}
                  style={[styles.galleryRemoveButton, { backgroundColor: colors.backgroundElevated }]}
                />
                <RNView style={[styles.galleryImageNumber, { backgroundColor: colors.tint }]}>
                  <Text style={[styles.galleryImageNumberText, { color: colors.onTint }]}>{index + 1}</Text>
                </RNView>
              </RNView>
              <RNView style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <IconButton icon="arrow-back" accessibilityLabel={`Move page ${index + 1} earlier`} disabled={index === 0} onPress={() => moveImage(index, -1)} />
                <IconButton icon="arrow-forward" accessibilityLabel={`Move page ${index + 1} later`} disabled={index === selectedImages.length - 1} onPress={() => moveImage(index, 1)} />
              </RNView>
              </RNView>
            ))}

            {/* Add More Button */}
            {selectedImages.length < 10 && (
              <TouchableOpacity
                style={[styles.galleryAddButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
                onPress={handleScanRecipe}
              >
                <Ionicons name="add" size={32} color={colors.actionText} />
                <Text style={[styles.galleryAddText, { color: colors.textMuted }]}>Add Page</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* Info Text */}
          <Text style={[styles.galleryHint, { color: colors.textMuted }]}>
            {selectedImages.length === 1
              ? 'Add more screenshots or pages for a complete recipe. Original pages are kept privately with your recipe.'
              : `${selectedImages.length} images will be combined in this order. Original pages are kept privately with your recipe.`}
          </Text>

          <RecipeDraftNotice draft={scanDraft} />
          <RecipeDraftNotice draft={recoveryDraft} />
          <Text>Håfa keeps your original pages privately so you can check them later. You can remove them anytime.</Text>
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
                <Ionicons name="clipboard-outline" size={16} color={colors.actionText} />
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
            <TouchableOpacity style={styles.textAction} onPress={() => { Keyboard.dismiss(); setPanel('settings'); }}
              disabled={!preferences.ready || isLoading || isCheckingDisclosure} accessibilityRole="button" accessibilityLabel="Import settings"
              accessibilityHint={`${isPublic ? 'Public in Discover. Anyone can find this recipe.' : 'Private. Only you can open this recipe.'} Cost estimates for ${selectedLocation}.${notes.trim() ? ' Personal notes added.' : ''}`}>
              <Text style={{ color: colors.textSecondary }}>Cost estimates: {selectedLocation}{notes.trim() ? ' · Notes added' : ''}</Text>
              <Ionicons name="options-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            <RecipeVisibilitySelector compact value={isPublic ? 'public' : 'private'}
              onChange={(value) => { const next = value === 'public'; setIsPublic(next); rememberImportSettings({ isPublic: next }); }}
              disabled={!preferences.ready || isLoading || isCheckingDisclosure} />
            <Button title={!isSignedIn ? 'Sign In to Import' : isPreparingImports ? 'Preparing Imports...' : isChecking ? 'Checking...' : extraction.isExtracting ? 'Add to Queue' : 'Import Recipe'}
              onPress={!isSignedIn ? () => router.push('/(auth)/sign-in') : () => { Keyboard.dismiss(); return handleExtract(); }}
              disabled={Boolean(isSignedIn) && (!preferences.ready || isPreparingImports || isLoading || isCheckingDisclosure || !url.trim())}
              loading={isChecking} size="md" />
          </RNView>



          {inbox.storageError && <Text style={{ color: colors.error }}>{inbox.storageError}</Text>}
          {preferences.error && <Text style={{ color: colors.error }}>{preferences.error}</Text>}


          <Text style={[styles.otherWaysLabel, { color: colors.textMuted }]}>Other ways to add</Text>
          <RNView style={[styles.alternateMethods, { borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}>
            {([
              { title: 'Paste recipe text', icon: 'clipboard-outline', onPress: () => router.push({ pathname: '/paste-recipe', params: { location: selectedLocation, isPublic: isPublic ? 'true' : 'false' } }) },
              { title: 'Scan photos or screenshots', icon: 'camera-outline', onPress: handleScanRecipe },
              { title: 'Write your own recipe', icon: 'create-outline', onPress: () => router.push({ pathname: '/add-recipe', params: { isPublic: isPublic ? 'true' : 'false' } }) },
            ] as const).map((method, index) => (
              <TouchableOpacity key={method.title} accessibilityRole="button" accessibilityLabel={method.title}
                onPress={method.onPress} disabled={!isSignedIn || !preferences.ready || isLoading} activeOpacity={0.7}
                style={[styles.alternateRow, index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                <Ionicons name={method.icon} size={21} color={colors.actionText} />
                <Text style={[styles.alternateTitle, { color: colors.text }]}>{method.title}</Text>
                <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </RNView>
          <RecipeDraftNotice draft={scanDraft} />
          <RecipeDraftNotice draft={recoveryDraft} />
          <ImportActivityCard jobs={isSignedIn ? recentImports.data || [] : []}
            captures={[...(pendingShares > 0 ? [{ id: 'native-waiting', createdAt: 0, content: <RNView style={[styles.pendingShareNotice, { borderColor: colors.border }]}>
            <Text style={{ color: colors.text }}>{pendingShares} shared {pendingShares === 1 ? 'recipe' : 'recipes'} waiting to sync</Text>
            <TouchableOpacity disabled={isOpeningNextShare} onPress={() => {
              if (!ShareIntentModule || openingNextShare.current) return;
              openingNextShare.current = true;
              setIsOpeningNextShare(true);
              void Promise.resolve(ShareIntentModule.getShareIntent('')).catch(() => {
                openingNextShare.current = false;
                setIsOpeningNextShare(false);
              });
            }} accessibilityRole="button" accessibilityLabel="Open next shared recipe">
              <Text style={{ color: colors.actionText }}>Open next</Text>
            </TouchableOpacity>
          </RNView> }] : []), ...inbox.entries.filter((entry) => !entry.jobId || !recentImports.data?.some((job) => job.id === entry.jobId) && entry.jobId !== extraction.jobId).map((entry) => ({
              id: entry.id, createdAt: entry.createdAt, content: <RNView key={entry.id} style={styles.inboxRow}>
              <RNView style={{ flex: 1 }}>
                <Text style={{ color: colors.text }} numberOfLines={1}>{entry.capture.kind === 'url' ? entry.capture.url : entry.capture.kind === 'text' ? 'Shared recipe text' : `${entry.capture.images.length} recipe images`}</Text>
                <Text style={[styles.hint, { color: entry.error ? colors.error : colors.textMuted }]}>
                  {entry.error ? `Needs help · ${entry.error}` : (entry.ownerId === null ? (!isSignedIn ? 'Sign in to finish importing' : inbox.ownerId ? 'Tap Finish to import it into your library' : 'Getting your account ready…') : entry.state === 'submitting' ? 'Importing…' : entry.state === 'ready' ? 'Waiting · starts after the current import' : 'Waiting · Ready to review')}
                </Text>
              </RNView>
              {(entry.state === 'waiting' || entry.state === 'error' || entry.state === 'submitting' || entry.submissionClaimed || entry.ownerId === null) && <TouchableOpacity disabled={extraction.isExtracting || Boolean(isSignedIn && !inbox.ownerId)} onPress={() => {
                void (extraction.canRetryStart && extraction.requestKey === `share:${entry.id}` ? extraction.retryPendingStart() : openCapturedEntry(entry)).catch((error: Error) => Alert.alert('Could Not Open Import', error.message));
              }} accessibilityRole="button" accessibilityLabel="Finish shared import"><Text style={{ color: colors.actionText }}>{entry.submissionClaimed || entry.state === 'submitting' || extraction.canRetryStart && extraction.requestKey === `share:${entry.id}` ? 'Reconnect' : entry.state === 'error' ? 'Retry' : 'Finish'}</Text></TouchableOpacity>}
              {entry.state !== 'submitting' && !entry.submissionClaimed && !(extraction.canRetryStart && extraction.requestKey === `share:${entry.id}`) && <TouchableOpacity onPress={() => { if (captureOwner.current.ownerId !== inbox.ownerId) return; void importInbox.removeWaiting(entry.id, entry.ownerId === null ? null : inbox.ownerId).catch((error: Error) => Alert.alert('Could Not Remove Import', error.message)); }} accessibilityRole="button" accessibilityLabel="Remove waiting import"><Ionicons name="close" size={18} color={colors.textMuted} /></TouchableOpacity>}
            </RNView>,
            }))]}
            active={(extraction.isExtracting || extraction.isComplete || extraction.isFailed) ? {
              id: extraction.jobId || 'active',
              createdAt: Date.parse(recentImports.data?.find((job) => job.id === extraction.jobId)?.created_at || '') || 0,
              content: (extraction.isExtracting || extraction.isComplete || extraction.isFailed) && (
            <RNView style={[styles.compactProgress, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
              <RNView style={styles.pendingShareCopy}>
                {extraction.isExtracting ? <ActivityIndicator color={colors.actionText} /> : <Ionicons
                  name={extraction.isFailed ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={22} color={extraction.isFailed ? colors.error : colors.actionText} />}
                <RNView style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontFamily: fontFamily.semibold, fontWeight: '600' }} accessibilityRole="header">
                    {importStatus.title}
                    {extraction.sourceUrl ? ` · ${importSourceLabel(extraction.sourceUrl)}` : ''}
                  </Text>
                  <Text style={[styles.hint, { color: colors.textMuted }]} numberOfLines={2}>
                    {extraction.sourceUrl ? `${importSourceDetail(extraction.sourceUrl)} · ` : ''}{importStatus.description}
                  </Text>
                </RNView>
                <TouchableOpacity style={styles.detailsAction} onPress={() => setShowProgressDetails(!showProgressDetails)} accessibilityRole="button" accessibilityLabel="Import details" accessibilityState={{ expanded: showProgressDetails }}>
                  <Ionicons name={showProgressDetails ? 'chevron-up' : 'chevron-down'} size={20} color={colors.actionText} />
                </TouchableOpacity>
              </RNView>
              {extraction.isExtracting && <RNView style={[styles.progressTrack, { backgroundColor: colors.border }]}
                accessibilityRole="progressbar" accessibilityLabel="Recipe import progress"
                accessibilityValue={{ min: 0, max: 100, now: importStatus.progress }}>
                <RNView style={{ width: `${importStatus.progress}%`, height: 3, backgroundColor: colors.tint }} />
              </RNView>}

              {showProgressDetails && <ExtractionProgress
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
          />}
          {extraction.isComplete && extraction.recipeId ? (
            <>
              <RNView style={styles.statusActions}>
                <Button
                  title="Open Recipe"
                  onPress={handleReviewCompletedRecipe}
                  size="md"
                  style={styles.openRecipeAction}
                />
                <TouchableOpacity style={styles.textAction} onPress={clearCompletedExtraction} accessibilityRole="button" accessibilityLabel="Dismiss saved import">
                  <Text style={[styles.smallActionText, { color: colors.textSecondary }]}>Dismiss</Text>
                </TouchableOpacity>
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
                    size="md"
                  />
                </RNView>
              )}
              <RNView style={styles.buttonRow}>
                <Button
                  title={extraction.canRetryStart ? 'Reconnect' : 'Retry Import'}
                  onPress={extraction.canRetryStart ? extraction.retryPendingStart : handleRetry}
                  disabled={isSavingSourceDraft}
                  variant={extraction.canSaveDraft ? 'secondary' : 'primary'}
                  size="md"
                />
              </RNView>
              {extraction.jobId && !extraction.recipeId && !extraction.canRetryStart && <TouchableOpacity
                style={styles.textAction} onPress={() => handleCancel()} disabled={isSavingSourceDraft}
                accessibilityRole="button" accessibilityLabel="Remove unfinished import">
                <Text style={[styles.smallActionText, { color: colors.textSecondary }]}>Remove unfinished import</Text>
              </TouchableOpacity>}
            </>
          ) : (
            <RNView style={styles.statusActions}>
              <Text style={[styles.hint, { color: colors.textMuted, flex: 1 }]}>You can leave Håfa while this imports.</Text>
              <TouchableOpacity style={styles.textAction} onPress={() => handleCancel()} accessibilityRole="button" accessibilityLabel="Cancel import">
                <Text style={[styles.smallActionText, { color: colors.textSecondary }]}>Cancel import</Text>
              </TouchableOpacity>
            </RNView>
          )}


            </RNView>
          ),
            } : null}
            onOpenRecipe={(job) => { if (job.recipe_id) router.push(`/recipe/${job.recipe_id}`); }}
            onRestore={extraction.restoreJob} onCancel={handleCancel} />
          <RNView style={styles.helpActions}>
            <TouchableOpacity style={styles.textAction} onPress={() => { Keyboard.dismiss(); setPanel('help'); }}
              accessibilityRole="button" accessibilityLabel="Import help">
              <Ionicons name="help-circle-outline" size={18} color={colors.textMuted} />
              <Text style={[styles.smallActionText, { color: colors.textSecondary }]}>Import help</Text>
            </TouchableOpacity>
            {isSignedIn && <TouchableOpacity style={styles.textAction} accessibilityRole="button" accessibilityLabel="Ask Håfa"
              onPress={() => { Keyboard.dismiss(); setHasOpenedChat(true); setShowChat(true); }}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.actionText} />
              <Text style={[styles.smallActionText, { color: colors.text }]}>Ask Håfa</Text>
            </TouchableOpacity>}
          </RNView>
        </ScrollView>

        {!isSignedIn && <SignInBanner message="Sign in to extract recipes" />}
      </KeyboardAvoidingView>
      <ImportSettingsPanel visible={panel === 'settings'} onClose={() => setPanel(null)}
        isPublic={isPublic} onVisibilityChange={(value) => { setIsPublic(value); rememberImportSettings({ isPublic: value }); }} location={selectedLocation}
        locations={locationsData?.locations || []} onLocationChange={(value) => { setSelectedLocation(value); rememberImportSettings({ location: value }); }}
        notes={notes} onNotesChange={setNotes} disabled={!preferences.ready || isLoading || isCheckingDisclosure} />
      <ImportHelpPanel visible={panel === 'help'} onClose={() => setPanel(null)} onWebsiteSupport={handleWebsiteSupportPress} />
      {isSignedIn && hasOpenedChat && <RecipeChatModal isVisible={showChat} onClose={() => setShowChat(false)} />}
    </RNView>
  );
}

const styles = StyleSheet.create({
  linkComposer: { padding: spacing.md, borderWidth: 1, borderRadius: radius.lg, marginBottom: spacing.md, gap: spacing.xs },
  detailsAction: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { height: 3, borderRadius: 2, overflow: 'hidden' },
  statusActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  openRecipeAction: { flexGrow: 1 },
  composerLabelRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
  composerLabel: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, fontWeight: '600' },
  textAction: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.xs },
  smallActionText: { fontSize: fontSize.sm, fontFamily: fontFamily.medium, fontWeight: '500' },
  supportedSources: { fontSize: fontSize.xs, lineHeight: 18 },
  settingsSummary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, minHeight: 56 },
  settingsCopy: { flex: 1 },
  settingsTitle: { fontSize: fontSize.sm, fontFamily: fontFamily.medium, fontWeight: '500' },
  otherWaysLabel: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, fontWeight: '600', marginBottom: spacing.sm },
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
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
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
    fontFamily: fontFamily.semibold, fontWeight: '600',
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
    width: 44,
    height: 44,
    borderRadius: 22,
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
