import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View as RNView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, useColors } from '@/components/Themed';
import { fontSize, fontWeight, radius, spacing } from '@/constants/Colors';
import {
  REPORT_CATEGORY_OPTIONS,
  canSubmitAppeal,
  canSubmitReport,
} from '@/lib/communitySafety';
import type { ReportCategory, SafetyTargetType } from '@/types/communitySafety';

interface SafetyActionModalProps {
  visible: boolean;
  mode: 'report' | 'appeal';
  targetType: SafetyTargetType;
  targetLabel: string;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (payload: { category: ReportCategory | null; details: string }) => Promise<void>;
}

export function SafetyActionModal({
  visible,
  mode,
  targetType,
  targetLabel,
  isSubmitting,
  onClose,
  onSubmit,
}: SafetyActionModalProps) {
  const colors = useColors();
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [details, setDetails] = useState('');

  useEffect(() => {
    if (!visible) {
      setCategory(null);
      setDetails('');
    }
  }, [visible]);

  const isReport = mode === 'report';
  const canSubmit = isReport
    ? canSubmitReport(category, details)
    : canSubmitAppeal(details);
  const title = isReport
    ? `Report ${targetType === 'recipe' ? 'recipe' : 'contributor'}`
    : `Appeal ${targetType === 'recipe' ? 'recipe hold' : 'account hold'}`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        accessibilityViewIsModal
      >
        <RNView style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={onClose}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="Close safety form"
            style={styles.headerButton}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{title}</Text>
          <RNView style={styles.headerButton} />
        </RNView>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <RNView style={[styles.notice, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name="shield-checkmark-outline" size={22} color={colors.accent} />
            <RNView style={styles.noticeCopy}>
              <Text style={[styles.noticeTitle, { color: colors.text }]} numberOfLines={2}>
                {targetLabel}
              </Text>
              <Text style={[styles.noticeText, { color: colors.textSecondary }]}>
                {isReport
                  ? 'Your report is private and will be reviewed by the Håfa Recipes team.'
                  : 'Tell us what changed or why this decision should be reviewed again.'}
              </Text>
            </RNView>
          </RNView>

          {isReport && (
            <RNView>
              <Text style={[styles.sectionLabel, { color: colors.text }]}>What is the concern?</Text>
              <RNView style={styles.options}>
                {REPORT_CATEGORY_OPTIONS.map((option) => {
                  const selected = category === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      onPress={() => setCategory(option.value)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      style={[
                        styles.option,
                        {
                          borderColor: selected ? colors.tint : colors.border,
                          backgroundColor: selected ? `${colors.tint}12` : colors.backgroundSecondary,
                        },
                      ]}
                    >
                      <RNView style={styles.optionCopy}>
                        <Text style={[styles.optionLabel, { color: colors.text }]}>{option.label}</Text>
                        <Text style={[styles.optionDescription, { color: colors.textMuted }]}>
                          {option.description}
                        </Text>
                      </RNView>
                      <Ionicons
                        name={selected ? 'radio-button-on' : 'radio-button-off'}
                        size={22}
                        color={selected ? colors.tint : colors.textMuted}
                      />
                    </TouchableOpacity>
                  );
                })}
              </RNView>
            </RNView>
          )}

          <RNView>
            <Text style={[styles.sectionLabel, { color: colors.text }]}>
              {isReport ? 'Additional details (optional)' : 'Why should we review this?'}
            </Text>
            <TextInput
              value={details}
              onChangeText={setDetails}
              maxLength={1000}
              multiline
              editable={!isSubmitting}
              placeholder={
                isReport
                  ? 'Add context that will help the reviewer…'
                  : 'Explain what changed and why the hold should be removed…'
              }
              placeholderTextColor={colors.textMuted}
              style={[
                styles.detailsInput,
                {
                  color: colors.text,
                  backgroundColor: colors.backgroundSecondary,
                  borderColor: colors.border,
                },
              ]}
            />
            <RNView style={styles.inputHelpRow}>
              <Text style={[styles.helpText, { color: colors.textMuted }]}>
                {(mode === 'appeal' || category === 'other') && 'At least 10 characters'}
              </Text>
              <Text style={[styles.helpText, { color: colors.textMuted }]}>{details.length}/1000</Text>
            </RNView>
          </RNView>
        </ScrollView>

        <RNView style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <TouchableOpacity
            onPress={() => onSubmit({ category, details: details.trim() })}
            disabled={!canSubmit || isSubmitting}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit || isSubmitting }}
            style={[
              styles.submitButton,
              { backgroundColor: canSubmit && !isSubmitting ? colors.tint : colors.border },
            ]}
          >
            <Text style={styles.submitText}>
              {isSubmitting ? 'Submitting…' : isReport ? 'Submit report' : 'Submit appeal'}
            </Text>
          </TouchableOpacity>
        </RNView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    minHeight: 58,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  notice: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg },
  noticeCopy: { flex: 1, gap: spacing.xs },
  noticeTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  noticeText: { fontSize: fontSize.sm, lineHeight: 19 },
  sectionLabel: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, marginBottom: spacing.sm },
  options: { gap: spacing.sm },
  option: {
    minHeight: 68,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  optionCopy: { flex: 1, gap: 2 },
  optionLabel: { fontSize: fontSize.md, fontWeight: fontWeight.medium },
  optionDescription: { fontSize: fontSize.sm, lineHeight: 18 },
  detailsInput: {
    minHeight: 120,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.md,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  inputHelpRow: { marginTop: spacing.xs, flexDirection: 'row', justifyContent: 'space-between' },
  helpText: { fontSize: fontSize.xs },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, padding: spacing.md },
  submitButton: { minHeight: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#FFFFFF', fontSize: fontSize.md, fontWeight: fontWeight.semibold },
});
