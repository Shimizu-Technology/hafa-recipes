import { getIngredientAmount, formatIngredientAmount, normalizeIngredientUnit } from '@/lib/recipeTrust';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Button, Text, useColors } from '@/components/Themed';
import { api } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/apiErrorMessage';
import { buildRecipeIssueEdit, getIssueIngredient, getRecipeReviewIssues } from '@/lib/recipeReviewIssues';
import type { Recipe } from '@/types/recipe';

/** An optional, short review of the uncertainties on an already-saved recipe. */
export function RecipeDetailsReview({ recipe, onClose, onOpenSource, onEdit }: {
  recipe: Recipe;
  onClose: () => void;
  onOpenSource?: () => void;
  onEdit: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  // Keep the content revision and field paths together even if a background refetch finishes.
  const [snapshot] = useState(recipe);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [resolvedIssues, setResolvedIssues] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const issues = getRecipeReviewIssues(snapshot);
  const hasChanges = Object.values(quantities).some(value => value.trim()) || accepted.size > 0 || resolvedIssues.size > 0;

  const close = () => { if (!savingRef.current) onClose(); };
  const save = async () => {
    if (savingRef.current) return;
    if (!hasChanges) { onClose(); return; }
    savingRef.current = true;
    setSaving(true);
    try {
      const edit = buildRecipeIssueEdit(snapshot, quantities, accepted, resolvedIssues, units);
      if (!edit.verified_paths?.length && !edit.resolved_issue_ids?.length) { onClose(); return; }
      const updated = await api.editRecipe(snapshot.id, edit);
      if (!mountedRef.current) return;
      queryClient.setQueryData(['recipes', 'detail', snapshot.id], updated);
      queryClient.setQueryData(['recipe', snapshot.id], updated);
      for (const key of ['recipes', 'savedRecipes', 'discover', 'recipeVersions', 'mealPlans', 'extractionJobs']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    } catch (error) {
      if (mountedRef.current) Alert.alert('Couldn’t save changes', getApiErrorMessage(error, 'Your changes are still here. Try again when you’re connected.'));
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardAvoidingView
        style={[styles.screen, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16), borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>Check details</Text>
          <TouchableOpacity onPress={close} disabled={saving} style={styles.close} accessibilityRole="button" accessibilityLabel="Close optional review">
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.intro, { color: colors.textSecondary }]}>Your recipe is already saved. Change anything you can confirm, or leave it for later.</Text>
          {issues.map((issue, index) => {
            const ingredient = getIssueIngredient(snapshot, issue.path);
            const amount = ingredient ? getIngredientAmount(ingredient) : null;
            return (
              <View key={issue.path ?? `source-${index}`} style={[styles.issue, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
                <Text style={[styles.issueTitle, { color: colors.text }]}>{ingredient?.name ?? 'Source details'}</Text>
                <Text style={[styles.message, { color: colors.textSecondary }]}>
                  {amount?.isEstimate
                    ? `${formatIngredientAmount(amount.quantity, amount.unit)} · AI estimate${amount.reason ? `\n${amount.reason}` : ''}`
                    : issue.message}
                </Text>
                {ingredient && issue.path && (
                  <>
                    <TextInput
                      style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                      value={quantities[issue.path] ?? ''}
                      onChangeText={value => setQuantities(current => ({ ...current, [issue.path!]: value }))}
                      placeholder="Amount from the source"
                      placeholderTextColor={colors.textMuted}
                      accessibilityLabel={`Amount for ${ingredient.name}`}
                      editable={!saving}
                    />
                    {!!quantities[issue.path]?.trim() && (
                      <View style={styles.unitCorrection}>
                        <Text style={[styles.message, { color: colors.textSecondary }]}>Unit from the source</Text>
                        <View style={styles.unitRow}>
                          <TextInput
                            style={[styles.input, styles.unitInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                            value={units[issue.path] ?? normalizeIngredientUnit(ingredient.unit) ?? ''}
                            onChangeText={value => setUnits(current => ({ ...current, [issue.path!]: value }))}
                            placeholder={amount?.isEstimate && amount.unit ? `e.g. ${amount.unit}` : 'e.g. cups, tsp'}
                            placeholderTextColor={colors.textMuted}
                            accessibilityLabel={`Unit for ${ingredient.name}`}
                            editable={!saving}
                            autoCapitalize="none"
                          />
                          <TouchableOpacity
                            style={styles.noUnit}
                            disabled={saving}
                            onPress={() => setUnits(current => ({ ...current, [issue.path!]: '' }))}
                            accessibilityRole="button"
                            accessibilityState={{ selected: units[issue.path] === '' }}
                            accessibilityLabel={`No unit for ${ingredient.name}`}
                          >
                            <Text style={{ color: colors.tint }}>{units[issue.path] === '' ? 'No unit selected' : 'No unit'}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                    <TouchableOpacity
                      style={styles.accept} disabled={saving}
                      onPress={() => setAccepted(current => {
                        const next = new Set(current);
                        if (next.has(issue.path!)) next.delete(issue.path!); else next.add(issue.path!);
                        return next;
                      })}
                      accessibilityRole="checkbox" accessibilityState={{ checked: accepted.has(issue.path) }}
                      accessibilityLabel={amount?.isEstimate ? `Keep AI estimate for ${ingredient.name}` : `Confirm the source gives no amount for ${ingredient.name}`}
                    >
                      <Ionicons name={accepted.has(issue.path) ? 'checkbox' : 'square-outline'} size={22} color={colors.tint} />
                      <Text style={[styles.acceptText, { color: colors.text }]}>{amount?.isEstimate ? 'Keep AI estimate' : 'The source doesn’t give an amount'}</Text>
                    </TouchableOpacity>
                  </>
                )}
                {issue.code === 'source_warning' && typeof issue.id === 'string' && (
                  <TouchableOpacity style={styles.accept} disabled={saving}
                    onPress={() => setResolvedIssues(current => {
                      const next = new Set(current);
                      if (next.has(issue.id!)) next.delete(issue.id!); else next.add(issue.id!);
                      return next;
                    })}
                    accessibilityRole="checkbox" accessibilityState={{ checked: resolvedIssues.has(issue.id) }}
                    accessibilityLabel={`Confirm you checked: ${issue.message}`}
                  >
                    <Ionicons name={resolvedIssues.has(issue.id) ? 'checkbox' : 'square-outline'} size={22} color={colors.tint} />
                    <Text style={[styles.acceptText, { color: colors.text }]}>I checked this detail</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
          {onOpenSource && <Button title="Open original" onPress={onOpenSource} variant="secondary" disabled={saving} />}
          <TouchableOpacity onPress={onEdit} disabled={saving || hasChanges} style={styles.edit} accessibilityRole="button">
            <Text style={{ color: colors.textSecondary, textDecorationLine: 'underline' }}>Edit other recipe details</Text>
          </TouchableOpacity>
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16), borderTopColor: colors.border }]}>
          <Button title={hasChanges ? 'Save changes' : 'Done'} onPress={() => void save()} loading={saving} disabled={saving} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 12, borderBottomWidth: 1 },
  title: { fontFamily: 'Fraunces_600SemiBold', fontSize: 26 },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 24, gap: 20 },
  intro: { fontSize: 16, lineHeight: 24 },
  issue: { padding: 18, borderRadius: 16, borderWidth: 1, gap: 12 },
  issueTitle: { fontSize: 19, fontWeight: '600' },
  message: { fontSize: 15, lineHeight: 22 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 17 },
  unitCorrection: { gap: 8 },
  unitRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  unitInput: { flex: 1 },
  noUnit: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  accept: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  acceptText: { flex: 1, fontSize: 14, lineHeight: 20 },
  edit: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  footer: { padding: 24, borderTopWidth: 1 },
});
