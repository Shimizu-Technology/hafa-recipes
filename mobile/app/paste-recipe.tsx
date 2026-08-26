import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View as RNView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, Text, useColors } from '@/components/Themed';
import { fontFamily, fontSize, fontWeight, radius, spacing } from '@/constants/Colors';
import { useLocations } from '@/hooks/useRecipes';
import { usePublishingDisclosure } from '@/hooks/usePublishingDisclosure';
import { api } from '@/lib/api';
import {
  MAX_PASTED_RECIPE_CHARS,
  canExtractPastedRecipe,
  normalizePastedRecipeText,
} from '@/lib/textCapture';

export default function PasteRecipeScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ location?: string; isPublic?: string }>();
  const { data: locationsData } = useLocations();
  const { requestPublishing, isCheckingDisclosure } = usePublishingDisclosure();

  const [recipeText, setRecipeText] = useState('');
  const [selectedLocation, setSelectedLocation] = useState(params.location || 'Guam');
  const [isPublic, setIsPublic] = useState(params.isPublic === 'true');
  const [isExtracting, setIsExtracting] = useState(false);

  const characterCount = recipeText.length;
  const isOverLimit = characterCount > MAX_PASTED_RECIPE_CHARS;
  const canExtract = canExtractPastedRecipe(recipeText) && !isExtracting;

  const locations = locationsData?.locations?.length
    ? locationsData.locations.slice().sort((a, b) => {
        if (a.name === 'Guam') return -1;
        if (b.name === 'Guam') return 1;
        return 0;
      })
    : [{ code: 'GU', name: 'Guam' }];

  const handlePaste = async () => {
    try {
      const clipboardText = normalizePastedRecipeText(await Clipboard.getStringAsync());
      if (!clipboardText) {
        Alert.alert('Nothing to Paste', 'Copy the recipe text first, then try again.');
        return;
      }
      setRecipeText(clipboardText);
    } catch {
      Alert.alert('Paste Failed', 'Could not read the clipboard. You can still type or paste into the box.');
    }
  };

  const handlePublicToggle = async () => {
    if (isPublic) {
      setIsPublic(false);
      return;
    }
    if (await requestPublishing()) setIsPublic(true);
  };

  const handleExtract = async () => {
    if (!canExtract) return;
    if (isPublic && !(await requestPublishing())) {
      setIsPublic(false);
      return;
    }

    Keyboard.dismiss();
    setIsExtracting(true);
    try {
      const result = await api.extractRecipeFromText(
        normalizePastedRecipeText(recipeText),
        selectedLocation,
      );
      if (!result.success || !result.recipe) {
        Alert.alert(
          'Could Not Build a Recipe',
          result.error || 'Make sure the pasted text includes ingredients and cooking steps.',
        );
        return;
      }

      router.push({
        pathname: '/ocr-review',
        params: {
          recipe: JSON.stringify(result.recipe),
          location: selectedLocation,
          isPublic: isPublic ? 'true' : 'false',
          sourceType: 'text',
        },
      });
    } catch (error: any) {
      const message = error?.response?.status === 413
        ? 'That text is too large. Shorten it to the recipe itself and try again.'
        : error?.response?.data?.detail || error?.message || 'Please try again.';
      Alert.alert('Import Failed', message);
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <RNView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Paste Recipe Text', headerBackTitle: 'Cancel' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <RNView style={[styles.introCard, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
            <RNView style={[styles.introIcon, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name="document-text-outline" size={26} color={colors.accent} />
            </RNView>
            <RNView style={styles.introCopy}>
              <Text style={[styles.introTitle, { color: colors.text }]}>Paste the whole recipe</Text>
              <Text style={[styles.introBody, { color: colors.textSecondary }]}>Copy a caption, DM, note, or recipe post. AI will organize it into ingredients and steps for you to review.</Text>
            </RNView>
          </RNView>

          <RNView style={styles.sectionHeader}>
            <Text style={[styles.label, { color: colors.text }]}>Recipe text</Text>
            <TouchableOpacity
              style={[styles.pasteButton, { backgroundColor: colors.tint + '14' }]}
              onPress={handlePaste}
              disabled={isExtracting}
              accessibilityRole="button"
              accessibilityLabel="Paste recipe text from clipboard"
            >
              <Ionicons name="clipboard-outline" size={16} color={colors.tint} />
              <Text style={[styles.pasteButtonText, { color: colors.tint }]}>Paste</Text>
            </TouchableOpacity>
          </RNView>

          <TextInput
            value={recipeText}
            onChangeText={setRecipeText}
            placeholder={'Recipe title\n\nIngredients\n- 2 cups...\n\nInstructions\n1. Mix...'}
            placeholderTextColor={colors.textMuted}
            multiline
            editable={!isExtracting}
            autoCapitalize="sentences"
            autoCorrect
            textAlignVertical="top"
            style={[
              styles.textInput,
              {
                color: colors.text,
                backgroundColor: colors.backgroundElevated,
                borderColor: isOverLimit ? colors.error : colors.border,
              },
            ]}
            accessibilityLabel="Pasted recipe text"
          />
          <RNView style={styles.inputMeta}>
            <Text style={[styles.inputHint, { color: colors.textMuted }]}>Include both ingredients and instructions for the best draft.</Text>
            <Text style={[styles.characterCount, { color: isOverLimit ? colors.error : colors.textMuted }]}>{characterCount.toLocaleString()} / {MAX_PASTED_RECIPE_CHARS.toLocaleString()}</Text>
          </RNView>

          <RNView style={[styles.privacyNotice, { backgroundColor: colors.accentSoft, borderColor: colors.accent + '55' }]}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} />
            <Text style={[styles.privacyText, { color: colors.textSecondary }]}>The text is sent to our AI provider to create your draft. Håfa Recipes does not save the original pasted text.</Text>
          </RNView>

          <RNView style={styles.section}>
            <Text style={[styles.label, { color: colors.text }]}>Location for cost estimates</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.locationRow}>
              {locations.map((location) => (
                <Chip
                  key={location.code}
                  label={location.name}
                  selected={selectedLocation === location.name}
                  onPress={() => !isExtracting && setSelectedLocation(location.name)}
                />
              ))}
            </ScrollView>
          </RNView>

          <TouchableOpacity
            style={[
              styles.shareToggle,
              {
                backgroundColor: isPublic ? colors.tint + '15' : colors.backgroundSecondary,
                borderColor: isPublic ? colors.tint : colors.border,
              },
            ]}
            onPress={handlePublicToggle}
            disabled={isExtracting || isCheckingDisclosure}
            accessibilityRole="switch"
            accessibilityLabel="Share recipe to the public library"
            accessibilityState={{ checked: isPublic, disabled: isExtracting || isCheckingDisclosure }}
          >
            <Ionicons name={isPublic ? 'globe' : 'lock-closed'} size={20} color={isPublic ? colors.tint : colors.textMuted} />
            <RNView style={styles.shareCopy}>
              <Text style={[styles.shareTitle, { color: colors.text }]}>{isPublic ? 'Share to Library' : 'Keep Private'}</Text>
              <Text style={[styles.shareSubtitle, { color: colors.textMuted }]}>{isPublic ? 'Others can discover the finished recipe' : 'Only visible to you'}</Text>
            </RNView>
            <Ionicons name={isPublic ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={isPublic ? colors.tint : colors.textMuted} />
          </TouchableOpacity>

          {isOverLimit && (
            <Text style={[styles.limitError, { color: colors.error }]}>Shorten the pasted text before creating a draft.</Text>
          )}

          <Button
            title={isExtracting ? 'Creating Draft...' : 'Create Recipe Draft'}
            onPress={handleExtract}
            disabled={!canExtract}
            loading={isExtracting}
            size="lg"
          />
          <RNView style={styles.reviewPromise}>
            {isExtracting ? <ActivityIndicator size="small" color={colors.tint} /> : <Ionicons name="eye-outline" size={16} color={colors.textMuted} />}
            <Text style={[styles.reviewPromiseText, { color: colors.textMuted }]}>You will review every ingredient and step before anything is saved.</Text>
          </RNView>
        </ScrollView>
      </KeyboardAvoidingView>
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: spacing.lg },
  introCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  introIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introCopy: { flex: 1, gap: spacing.xs },
  introTitle: { fontSize: fontSize.xl, fontFamily: fontFamily.displaySemibold },
  introBody: { fontSize: fontSize.sm, lineHeight: 20 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, marginBottom: spacing.sm },
  pasteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  pasteButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  textInput: {
    minHeight: 280,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.md,
    fontSize: fontSize.md,
    fontFamily: fontFamily.regular,
    lineHeight: 22,
  },
  inputMeta: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  inputHint: { flex: 1, fontSize: fontSize.xs, lineHeight: 17 },
  characterCount: { fontSize: fontSize.xs, fontFamily: fontFamily.medium },
  privacyNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginVertical: spacing.lg,
  },
  privacyText: { flex: 1, fontSize: fontSize.xs, lineHeight: 18 },
  section: { marginBottom: spacing.lg },
  locationRow: { gap: spacing.sm, paddingRight: spacing.lg },
  shareToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  shareCopy: { flex: 1 },
  shareTitle: { fontSize: fontSize.md, fontWeight: fontWeight.medium },
  shareSubtitle: { fontSize: fontSize.xs, marginTop: 2 },
  limitError: { fontSize: fontSize.sm, marginBottom: spacing.sm, textAlign: 'center' },
  reviewPromise: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  reviewPromiseText: { fontSize: fontSize.xs, textAlign: 'center', lineHeight: 18 },
});
