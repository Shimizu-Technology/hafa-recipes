import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, useColors } from '@/components/Themed';
import { LOOK_IDS, LOOKS, type LookId } from '@/constants/looks';
import { useLookPreview } from '@/contexts/LookContext';

/** Settings › Design preview: one row per look. Development and preview builds only. */
export function DesignPreviewSection() {
  const colors = useColors();
  const { id, enabled, setLook } = useLookPreview();
  const [pending, setPending] = useState<LookId | null>(null);
  if (!enabled) return null;
  const choose = async (next: LookId) => {
    if (next === id || pending) return;
    setPending(next);
    try { await setLook(next); } finally { setPending(null); }
  };
  return <View style={styles.section} testID="design-preview-section">
    <Text accessibilityRole="header" style={[styles.header, { color: colors.textSecondary }]}>Design preview</Text>
    <View style={[styles.group, { backgroundColor: colors.backgroundElevated }]}>
      {LOOK_IDS.map((lookId, index) => {
        const look = LOOKS[lookId];
        const selected = lookId === id;
        return <View key={lookId}>
          {index > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
          <Pressable onPress={() => { void choose(lookId); }} accessibilityRole="radio" accessibilityState={{ checked: selected, busy: pending === lookId }}
            accessibilityLabel={`${look.label}. ${look.description}`} testID={`look-${lookId}`}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}>
            <View style={styles.copy}>
              <Text style={[styles.label, { color: colors.text }]}>{look.label}</Text>
              <Text style={[styles.description, { color: colors.textSecondary }]}>{look.description}</Text>
            </View>
            {pending === lookId ? <ActivityIndicator color={colors.textSecondary} />
              : <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={selected ? colors.actionText : colors.textSecondary} />}
          </Pressable>
        </View>;
      })}
    </View>
    <Text style={[styles.footnote, { color: colors.textSecondary }]}>Only in development and preview builds. Also opens from hafarecipes://design-preview?look=island.</Text>
  </View>;
}

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  header: { fontSize: 13, lineHeight: 18, marginLeft: 16, marginBottom: 8 },
  group: { borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 },
  copy: { flex: 1, gap: 2 },
  label: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  description: { fontSize: 13, lineHeight: 18 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  footnote: { fontSize: 13, lineHeight: 18, marginHorizontal: 16, marginTop: 8 },
});
