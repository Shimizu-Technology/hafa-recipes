import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View as RNView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, View, useColors } from '@/components/Themed';
import { fontFamily, fontSize, fontWeight, radius, spacing } from '@/constants/Colors';
import type { Collection, MealPlanEntry } from '@/types/recipe';
import { RecipeCollectionsCard } from './RecipeCollectionsCard';
import { formatMealPlanDate, RecipeMealPlanCard } from './RecipeMealPlanCard';

type OrganizerPanel = 'collections' | 'plan' | 'notes';

type RecipeOrganizerProps = {
  recipeTitle: string;
  collections: readonly Collection[];
  areCollectionsLoading: boolean;
  onOpenCollection: (collectionId: string) => void;
  onManageCollections: () => void;
  planEntries: readonly MealPlanEntry[];
  isPlanLoading: boolean;
  hasPlanError: boolean;
  isPlanRetrying: boolean;
  onOpenPlanDate: (date: string) => void;
  onPlanRecipe: () => void;
  onRetryPlan: () => void;
  savedNote?: string | null;
  isNoteLoading: boolean;
  isNoteSaving: boolean;
  onSaveNote: (note: string) => Promise<void>;
};

const PANEL_TITLES: Record<OrganizerPanel, string> = {
  collections: 'Collections',
  plan: 'Meal plan',
  notes: 'My notes',
};

/** Keep a recipe's private organization tools compact until the cook needs one. */
export function RecipeOrganizer({
  recipeTitle,
  collections,
  areCollectionsLoading,
  onOpenCollection,
  onManageCollections,
  planEntries,
  isPlanLoading,
  hasPlanError,
  isPlanRetrying,
  onOpenPlanDate,
  onPlanRecipe,
  onRetryPlan,
  savedNote,
  isNoteLoading,
  isNoteSaving,
  onSaveNote,
}: RecipeOrganizerProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [activePanel, setActivePanel] = useState<OrganizerPanel | null>(null);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(savedNote || '');
  const isNoteSaveInFlight = isSubmittingNote || isNoteSaving;

  useEffect(() => {
    if (!isEditingNote) setNoteDraft(savedNote || '');
  }, [isEditingNote, savedNote]);

  const closeSheet = () => {
    if (isNoteSaveInFlight) return;
    setActivePanel(null);
    setIsEditingNote(false);
    setNoteDraft(savedNote || '');
  };

  const closeThen = (action: () => void) => {
    closeSheet();
    action();
  };

  const collectionSummary = areCollectionsLoading
    ? 'Checking…'
    : collections.length > 0
      ? `${collections.length} ${collections.length === 1 ? 'collection' : 'collections'}`
      : 'Not collected';
  const planSummary = isPlanLoading
    ? 'Checking…'
    : hasPlanError
      ? 'Unavailable'
      : planEntries[0]
        ? formatMealPlanDate(planEntries[0].date)
        : 'Not planned';
  const noteSummary = isNoteLoading ? 'Checking…' : savedNote ? 'Private note' : 'Add a note';

  const organizerActions: Array<{
    panel: OrganizerPanel;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    summary: string;
  }> = [
    { panel: 'collections', icon: 'folder-outline', label: 'Collections', summary: collectionSummary },
    { panel: 'plan', icon: 'calendar-outline', label: 'Plan', summary: planSummary },
    { panel: 'notes', icon: 'pencil-outline', label: 'Notes', summary: noteSummary },
  ];

  return (
    <>
      <RNView
        style={[styles.organizer, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
      >
        <RNView style={styles.organizerHeading}>
          <Text style={[styles.organizerTitle, { color: colors.text }]}>Save &amp; plan</Text>
          <Text style={[styles.organizerHint, { color: colors.textMuted }]}>Your private recipe tools</Text>
        </RNView>
        <RNView style={styles.actionRow}>
          {organizerActions.map((action) => (
            <TouchableOpacity
              key={action.panel}
              style={[styles.action, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setActivePanel(action.panel)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`Open ${action.label}. ${action.summary}`}
            >
              <Ionicons name={action.icon} size={20} color={colors.tint} />
              <Text style={[styles.actionLabel, { color: colors.text }]}>{action.label}</Text>
              <Text style={[styles.actionSummary, { color: colors.textMuted }]} numberOfLines={1}>
                {action.summary}
              </Text>
            </TouchableOpacity>
          ))}
        </RNView>
      </RNView>

      <Modal
        visible={activePanel !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        allowSwipeDismissal={!isNoteSaveInFlight}
        onRequestClose={closeSheet}
      >
        <View style={[styles.sheet, { paddingTop: insets.top }]}>
          <RNView style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
            <RNView style={styles.sheetHeadingCopy}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                {activePanel ? PANEL_TITLES[activePanel] : 'Save & plan'}
              </Text>
              <Text style={[styles.sheetSubtitle, { color: colors.textMuted }]} numberOfLines={1}>
                {recipeTitle}
              </Text>
            </RNView>
            <TouchableOpacity
              onPress={closeSheet}
              disabled={isNoteSaveInFlight}
              style={[styles.closeButton, { backgroundColor: colors.backgroundSecondary }]}
              accessibilityRole="button"
              accessibilityLabel="Close recipe organizer"
              accessibilityState={{ disabled: isNoteSaveInFlight }}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </RNView>

          {activePanel === 'notes' ? (
            <KeyboardAvoidingView
              style={styles.sheetBody}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
              <ScrollView
                contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + spacing.xl }]}
                keyboardShouldPersistTaps="handled"
              >
                <RNView style={[styles.noteCard, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
                  <RNView style={styles.noteHeader}>
                    <RNView style={styles.noteTitleRow}>
                      <Ionicons name="lock-closed-outline" size={18} color={colors.tint} />
                      <Text style={[styles.noteTitle, { color: colors.text }]}>Only you can see this</Text>
                    </RNView>
                    {!isEditingNote && !isNoteLoading && (
                      <TouchableOpacity
                        onPress={() => setIsEditingNote(true)}
                        style={[styles.editButton, { backgroundColor: colors.tint + '15' }]}
                        accessibilityRole="button"
                        accessibilityLabel={savedNote ? 'Edit private recipe note' : 'Add private recipe note'}
                      >
                        <Text style={[styles.editButtonText, { color: colors.tint }]}>
                          {savedNote ? 'Edit' : 'Add note'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </RNView>

                  {isNoteLoading ? (
                    <RNView style={styles.loadingRow}>
                      <ActivityIndicator size="small" color={colors.tint} />
                      <Text style={[styles.supportingText, { color: colors.textMuted }]}>Loading your note…</Text>
                    </RNView>
                  ) : isEditingNote ? (
                    <>
                      <TextInput
                        style={[styles.noteInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
                        placeholder="What would you change or remember next time?"
                        placeholderTextColor={colors.textMuted}
                        value={noteDraft}
                        onChangeText={setNoteDraft}
                        editable={!isNoteSaveInFlight}
                        multiline
                        autoFocus
                        textAlignVertical="top"
                        accessibilityLabel="Private recipe note"
                      />
                      <RNView style={styles.noteButtons}>
                        <TouchableOpacity
                          onPress={() => {
                            setNoteDraft(savedNote || '');
                            setIsEditingNote(false);
                          }}
                          disabled={isNoteSaveInFlight}
                          style={[
                            styles.secondaryButton,
                            { borderColor: colors.border, opacity: isNoteSaveInFlight ? 0.5 : 1 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="Cancel note editing"
                          accessibilityState={{ disabled: isNoteSaveInFlight }}
                        >
                          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={async () => {
                            const nextNote = noteDraft.trim();
                            if (!nextNote || isNoteSaveInFlight) return;
                            setIsSubmittingNote(true);
                            try {
                              await onSaveNote(nextNote);
                              setIsEditingNote(false);
                            } catch {
                              // The screen owns user-facing error reporting. Keep the
                              // editor open so the draft is not lost and can be retried.
                            } finally {
                              setIsSubmittingNote(false);
                            }
                          }}
                          disabled={!noteDraft.trim() || isNoteSaveInFlight}
                          style={[
                            styles.primaryButton,
                            {
                              backgroundColor: colors.tint,
                              opacity: !noteDraft.trim() || isNoteSaveInFlight ? 0.5 : 1,
                            },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="Save private recipe note"
                          accessibilityState={{
                            disabled: !noteDraft.trim() || isNoteSaveInFlight,
                            busy: isNoteSaveInFlight,
                          }}
                        >
                          {isNoteSaveInFlight && <ActivityIndicator size="small" color="#FFFFFF" />}
                          <Text style={styles.primaryButtonText}>
                            {isNoteSaveInFlight ? 'Saving…' : 'Save note'}
                          </Text>
                        </TouchableOpacity>
                      </RNView>
                    </>
                  ) : (
                    <Text style={[styles.noteText, { color: savedNote ? colors.textSecondary : colors.textMuted }]}>
                      {savedNote || 'Add a private reminder, substitution, or idea for next time.'}
                    </Text>
                  )}
                </RNView>
              </ScrollView>
            </KeyboardAvoidingView>
          ) : (
            <ScrollView
              style={styles.sheetBody}
              contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + spacing.xl }]}
            >
              {activePanel === 'collections' && (
                <RecipeCollectionsCard
                  collections={collections}
                  isLoading={areCollectionsLoading}
                  onOpenCollection={(collectionId) => closeThen(() => onOpenCollection(collectionId))}
                  onManageCollections={() => closeThen(onManageCollections)}
                />
              )}
              {activePanel === 'plan' && (
                <RecipeMealPlanCard
                  entries={planEntries}
                  isLoading={isPlanLoading}
                  hasError={hasPlanError}
                  isRetrying={isPlanRetrying}
                  onOpenDate={(date) => closeThen(() => onOpenPlanDate(date))}
                  onPlanRecipe={() => closeThen(onPlanRecipe)}
                  onRetry={onRetryPlan}
                />
              )}
            </ScrollView>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  organizer: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  organizerHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  organizerTitle: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.md,
  },
  organizerHint: {
    fontSize: fontSize.xs,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
    minWidth: 0,
    minHeight: 82,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  actionLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.xs,
  },
  actionSummary: {
    width: '100%',
    textAlign: 'center',
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  sheet: { flex: 1 },
  sheetHeader: {
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  sheetHeadingCopy: { flex: 1 },
  sheetTitle: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.xl,
  },
  sheetSubtitle: {
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBody: { flex: 1 },
  sheetContent: { padding: spacing.lg },
  noteCard: {
    padding: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  noteHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  noteTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  noteTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  editButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  supportingText: { fontSize: fontSize.sm },
  noteInput: {
    minHeight: 150,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.md,
    lineHeight: 22,
    marginTop: spacing.md,
  },
  noteText: {
    fontSize: fontSize.md,
    lineHeight: 23,
    marginTop: spacing.md,
  },
  noteButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondaryButton: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  primaryButton: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
