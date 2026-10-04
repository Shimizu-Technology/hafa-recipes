import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Input, Text, useColors } from '@/components/Themed';
import { RecipeVisibilitySelector } from '@/components/RecipeVisibilitySelector';
import { fontFamily, fontSize, radius, spacing } from '@/constants/Colors';

function ImportPanel({ visible, title, onClose, children }: {
  visible: boolean; title: string; onClose: () => void; children: ReactNode;
}) {
  const colors = useColors();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}
          edges={Platform.OS === 'ios' ? ['bottom', 'left', 'right'] : ['top', 'bottom', 'left', 'right']}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.done} accessibilityRole="button" accessibilityLabel={`Done with ${title.toLowerCase()}`}>
              <Text style={{ color: colors.text, fontFamily: fontFamily.semibold }}>Done</Text>
            </TouchableOpacity>
          </View>
          <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} keyboardDismissMode="interactive">{children}</ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

export function ImportSettingsPanel({ visible, onClose, isPublic, onVisibilityChange, location, locations, onLocationChange, notes, onNotesChange, disabled }: {
  visible: boolean; onClose: () => void; isPublic: boolean; onVisibilityChange: (isPublic: boolean) => void;
  location: string; locations: { code: string; name: string }[]; onLocationChange: (location: string) => void;
  notes: string; onNotesChange: (notes: string) => void; disabled: boolean;
}) {
  const colors = useColors();
  const [showLocations, setShowLocations] = useState(false);
  useEffect(() => { if (!visible) setShowLocations(false); }, [visible]);
  const choices = locations.some((choice) => choice.name === location)
    ? locations : [{ code: 'current', name: location }, ...locations];
  return (
    <ImportPanel visible={visible} title="Import settings" onClose={onClose}>
      <RecipeVisibilitySelector value={isPublic ? 'public' : 'private'}
        onChange={(value) => onVisibilityChange(value === 'public')} disabled={disabled} />
      <View style={styles.section}>
        <Text style={styles.label}>Cost estimate location</Text>
        <Text style={[styles.description, { color: colors.textMuted }]}>Use local prices when estimating ingredient costs.</Text>
        <TouchableOpacity disabled={disabled} onPress={() => setShowLocations(!showLocations)}
          accessibilityRole="button" accessibilityLabel={`Cost estimate location, ${location}`}
          accessibilityState={{ expanded: showLocations, disabled }}
          style={[styles.choice, styles.choices, { borderColor: colors.border }]}>
          <Ionicons name="location-outline" size={20} color={colors.tint} />
          <Text style={styles.choiceText}>{location}</Text>
          <Ionicons name={showLocations ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
        </TouchableOpacity>
        {showLocations && <View accessibilityRole="radiogroup" style={[styles.choices, { borderColor: colors.border }]}>
          {choices.map((choice, index) => (
            <TouchableOpacity key={choice.code} disabled={disabled} onPress={() => { onLocationChange(choice.name); setShowLocations(false); }}
              accessibilityRole="radio" accessibilityLabel={choice.name}
              accessibilityState={{ checked: choice.name === location, disabled }}
              style={[styles.choice, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
              <Text style={styles.choiceText}>{choice.name}</Text>
              <Ionicons name={choice.name === location ? 'checkmark-circle' : 'ellipse-outline'} size={22}
                color={choice.name === location ? colors.tint : colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>}
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>Personal notes</Text>
        <Text style={[styles.description, { color: colors.textMuted }]}>Optional. Add a reminder or a change you want to try.</Text>
        <Input accessibilityLabel="Personal notes" value={notes} onChangeText={onNotesChange}
          placeholder="e.g. Try with less sugar" multiline numberOfLines={3} editable={!disabled} />
      </View>
    </ImportPanel>
  );
}

export function ImportHelpPanel({ visible, onClose, onWebsiteSupport }: {
  visible: boolean; onClose: () => void; onWebsiteSupport: () => void;
}) {
  const colors = useColors();
  return (
    <ImportPanel visible={visible} title="Import help" onClose={onClose}>
      {[
        ['Start with a link', 'Copy a link from TikTok, Instagram, YouTube, or a recipe website, then paste it here.'],
        ['For the best results', 'Videos work best when ingredients and instructions are spoken or written in the caption. You can also import recipe text or photos.'],
        ['While a recipe imports', 'You can add another recipe or leave the app. Unfinished imports stay on this page, and saved recipes go to your Library.'],
        ['AI-assisted recipe extraction', 'Extracted and saved automatically. Any uncertain details will be highlighted. Check those details against the source before cooking.'],
        ['Sharing from another app', 'Choose Håfa Recipes in the share menu. Shared links import privately; you can publish them later.'],
      ].map(([title, description]) => (
        <View style={styles.section} key={title}>
          <Text style={styles.label}>{title}</Text>
          <Text style={[styles.helpCopy, { color: colors.textSecondary }]}>{description}</Text>
        </View>
      ))}
      <TouchableOpacity style={styles.support} onPress={onWebsiteSupport} accessibilityRole="button">
        <Ionicons name="mail-outline" size={20} color={colors.tint} />
        <Text style={[styles.choiceText, { color: colors.text }]}>Help with a recipe website</Text>
        <Ionicons name="open-outline" size={18} color={colors.tint} />
      </TouchableOpacity>
    </ImportPanel>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, gap: spacing.sm },
  title: { flex: 1, fontFamily: fontFamily.semibold, fontSize: fontSize.lg },
  done: { minHeight: 48, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  content: { padding: spacing.lg },
  section: { marginBottom: spacing.lg, gap: spacing.sm },
  label: { fontSize: fontSize.md, fontFamily: fontFamily.semibold },
  description: { fontSize: fontSize.sm, lineHeight: 20, marginBottom: spacing.xs },
  choices: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  choice: { flexDirection: 'row', alignItems: 'center', minHeight: 52, padding: spacing.md, gap: spacing.sm },
  choiceText: { flex: 1, fontSize: fontSize.md },
  helpCopy: { fontSize: fontSize.md, lineHeight: 24 },
  support: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: spacing.sm },
});
