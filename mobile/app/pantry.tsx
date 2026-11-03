import { TextInput } from '@/components/Themed';
import { fontFamily } from '@/constants/Colors';
import { useRecipeOwnerGeneration } from '@/hooks/useOfflineLease';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, TouchableOpacity, View as RNView,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatIngredientAmount, spokenQuantity } from '@/lib/quantityPresentation';

import { Text, useColors } from '@/components/Themed';
import { fontSize, fontWeight, layout, radius, spacing } from '@/constants/Colors';
import { useCopyPersonalPantry, usePantrySnapshot, usePantryWrite } from '@/hooks/usePantry';
import { appRoutes } from '@/lib/routes';
import { showToast } from '@/lib/toast';
import { pantryDateForEntry, pantryDateFromEntry, pantryDateStatus, parsePantryNames } from '@/lib/pantry';
import type { PantryDateKind, PantryItem, PantryItemFields } from '@/types/pantry';

const emptyFields = (): PantryItemFields => ({
  name: '', quantity: null, unit: null, location: null,
  date_kind: null, date_value: null, notes: null,
});
const todayKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export default function PantryScreen() {
  const generation = useRecipeOwnerGeneration();
  return <PantryScreenContent key={generation} />;
}

function PantryScreenContent() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isSignedIn } = useAuth();
  const active = usePantrySnapshot('active', Boolean(isSignedIn));
  const personal = usePantrySnapshot('personal', Boolean(isSignedIn) && active.data?.scope === 'household');
  const write = usePantryWrite();
  const copy = useCopyPersonalPantry();
  const [quickInput, setQuickInput] = useState('');
  const [editing, setEditing] = useState<PantryItem | 'new' | null>(null);
  const [editContext, setEditContext] = useState<{ space_id: string; base_revision: number } | null>(null);
  const [form, setForm] = useState<PantryItemFields>(emptyFields());
  const [dateText, setDateText] = useState('');
  const [search, setSearch] = useState('');
  const [showPersonal, setShowPersonal] = useState(false);
  const today = todayKey();
  const items = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('en');
    return (active.data?.items ?? []).filter((item) => item.name.toLocaleLowerCase('en').includes(term));
  }, [active.data?.items, search]);
  const uncopiedPersonal = (personal.data?.items ?? []).filter(
    (item) => !active.data?.copied_personal_item_ids?.includes(item.id),
  );
  const expiring = (active.data?.items ?? []).filter((item) => pantryDateStatus(item, today) !== 'ok').length;

  const openEditor = (item?: PantryItem) => {
    setEditContext(item && active.data ? {
      space_id: active.data.space_id,
      base_revision: active.data.revision,
    } : null);
    setEditing(item ?? 'new');
    setForm(item ? {
      name: item.name, quantity: item.quantity, unit: item.unit,
      location: item.location, date_kind: item.date_kind,
      date_value: item.date_value, notes: item.notes,
    } : emptyFields());
    setDateText(pantryDateForEntry(item?.date_value ?? null));
  };

  const quickAdd = async () => {
    const names = parsePantryNames(quickInput);
    if (!names.length || write.isPending) return;
    if (names.length > 30) {
      Alert.alert('Too many items', 'Add up to 30 items at a time.');
      return;
    }
    try {
      for (const name of names) await write.mutateAsync({ operation: 'add', item: { ...emptyFields(), name } });
      setQuickInput('');
    } catch {
      Alert.alert('Couldn’t add everything', 'Some items may have been saved. Refresh your pantry and try the remaining names.');
    }
  };

  const save = async () => {
    const name = form.name.trim();
    const date = dateText.trim();
    if (!name) return Alert.alert('Name needed', 'Enter an item name.');
    if (form.quantity !== null && (!/^\d+(\.\d{1,3})?$/.test(form.quantity) || Number(form.quantity) > 999999999.999)) {
      return Alert.alert('Check amount', 'Enter a positive number with up to three decimal places.');
    }
    const isoDate = date ? pantryDateFromEntry(date) : null;
    if (date && (!form.date_kind || !isoDate)) {
      return Alert.alert('Check date', 'Choose a date type and enter a valid date as MM/DD/YYYY.');
    }
    const item = { ...form, name, date_kind: date ? form.date_kind : null, date_value: isoDate };
    try {
      if (editing === 'new') await write.mutateAsync({ operation: 'add', item });
      else if (editing && editContext) {
        const changes = Object.fromEntries(
          (Object.keys(item) as Array<keyof PantryItemFields>)
            .filter((field) => item[field] !== editing[field])
            .map((field) => [field, item[field]]),
        ) as Partial<PantryItemFields>;
        if ('date_kind' in changes || 'date_value' in changes) {
          changes.date_kind = item.date_kind;
          changes.date_value = item.date_value;
        }
        if (Object.keys(changes).length) {
          await write.mutateAsync({ operation: 'update', item_id: editing.id, changes, ...editContext });
        }
      }
      setEditing(null);
    } catch {
      Alert.alert('Couldn’t save', 'The pantry may have changed. Refresh it and try again.');
    }
  };

  const remove = (item: PantryItem) => Alert.alert('Remove from pantry?', item.name, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => {
      if (!active.data) return;
      write.mutate({
        operation: 'delete', item_id: item.id,
        space_id: active.data.space_id, base_revision: active.data.revision,
      }, {
        onError: () => Alert.alert('Couldn’t remove', 'Refresh your pantry and try again.'),
      });
    } },
  ]);

  const sheet = { backgroundColor: colors.backgroundElevated, borderColor: colors.hairline };
  const copyPersonal = () => Alert.alert(
    'Copy to household pantry?',
    `Copy your ${uncopiedPersonal.length} personal item${uncopiedPersonal.length === 1 ? '' : 's'} so everyone in this household can see and edit them? Your personal pantry stays private.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Copy items', onPress: () => copy.mutate(undefined, {
        onError: () => Alert.alert('Couldn’t copy items', 'Refresh both pantries and try again.'),
        onSuccess: () => showToast({ message: 'Copied to the household pantry', tone: 'success' }),
      }) },
    ],
  );

  return <RNView style={[styles.root, { backgroundColor: colors.groupedBackground }]}>
    <Stack.Screen options={{ headerLargeTitleEnabled: true, headerLargeTitleStyle: { fontFamily: fontFamily.display, color: colors.text, fontSize: 34 }, title: 'My Pantry', headerStyle: { backgroundColor: colors.groupedBackground }, headerTintColor: colors.text }} />
    {!isSignedIn ? (
      <RNView style={styles.center}><Text style={styles.heading}>Save what you have</Text><Text style={{ color: colors.textSecondary }}>Sign in to keep a pantry and share it with your household.</Text></RNView>
    ) : active.isLoading ? (
      <RNView style={styles.center}><ActivityIndicator color={colors.actionText} /><Text style={{ color: colors.textSecondary }}>Loading pantry…</Text></RNView>
    ) : active.isError ? (
      <RNView style={styles.center}><Text style={styles.heading}>Couldn’t load your pantry</Text><Text style={{ color: colors.textSecondary }}>Check your connection and try again.</Text><TouchableOpacity onPress={() => active.refetch()} style={[styles.primary, { backgroundColor: colors.tint }]}><Text style={[styles.primaryText, { color: colors.onTint }]}>Try again</Text></TouchableOpacity></RNView>
    ) : <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]} keyboardShouldPersistTaps="handled">
      <Text style={[styles.subheading, { color: colors.textSecondary }]}>
        {active.data?.scope === 'household'
          ? 'Household pantry. Everyone on your shared grocery list sees it.'
          : 'Keep track of what you have, then find something to cook.'}
      </Text>
      <TouchableOpacity style={[styles.primary, sheet, { borderColor: colors.border }]} onPress={() => router.push(appRoutes.ingredientSearch)} accessibilityRole="button">
        <Ionicons name="restaurant-outline" color={colors.text} size={19} /><Text style={[styles.primaryText, { color: colors.text }]}>Find recipes from my pantry</Text>
      </TouchableOpacity>
      {expiring > 0 && <RNView style={[styles.notice, { backgroundColor: colors.warning + '16' }]}><Ionicons name="time-outline" size={18} color={colors.warning} /><Text style={[styles.noticeText, { color: colors.text }]}>{expiring} item{expiring === 1 ? '' : 's'} need a date check. Past dates are left out of recipe search.</Text></RNView>}
      {active.data?.scope === 'household' && uncopiedPersonal.length > 0 && <RNView style={[styles.personal, sheet]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Your private pantry</Text>
        <Text style={{ color: colors.textSecondary, lineHeight: 20 }}>{uncopiedPersonal.length} item{uncopiedPersonal.length === 1 ? '' : 's'} stay private until you choose to copy them.</Text>
        <RNView style={styles.personalActions}>
          <TouchableOpacity onPress={() => setShowPersonal(!showPersonal)} style={styles.textButton}><Text style={{ color: colors.actionText, fontWeight: fontWeight.semibold }}>{showPersonal ? 'Hide items' : 'View items'}</Text></TouchableOpacity>
          <TouchableOpacity onPress={copyPersonal} disabled={copy.isPending} style={styles.textButton} accessibilityRole="button" accessibilityLabel="Copy private pantry items to household"><Text style={{ color: colors.actionText, fontWeight: fontWeight.semibold }}>{copy.isPending ? 'Copying…' : 'Copy to household'}</Text></TouchableOpacity>
        </RNView>
        {showPersonal && uncopiedPersonal.map((item) => <Text key={item.id} style={{ color: colors.textSecondary, paddingTop: spacing.xs }}>• {item.name}</Text>)}
      </RNView>}
      <RNView style={[styles.addBox, sheet]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Add what you have</Text>
        <Text style={{ color: colors.textSecondary }}>Type one item, or paste a list separated by commas or new lines.</Text>
        <RNView style={styles.addRow}>
          <TextInput style={[styles.quickInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]} value={quickInput} onChangeText={setQuickInput} placeholder="e.g. rice, eggs, tomatoes" placeholderTextColor={colors.textMuted} multiline maxLength={2000} accessibilityLabel="Pantry items to add" />
          <TouchableOpacity onPress={quickAdd} disabled={!quickInput.trim() || write.isPending} style={[styles.addButton, { backgroundColor: colors.tint, opacity: !quickInput.trim() ? 0.4 : 1 }]} accessibilityLabel="Add pantry items"><Ionicons name="add" color={colors.onTint} size={26} /></TouchableOpacity>
        </RNView>
        <TouchableOpacity onPress={() => openEditor()} style={styles.textButton}><Text style={{ color: colors.actionText, fontWeight: fontWeight.semibold }}>Add amount, place, or date instead</Text></TouchableOpacity>
      </RNView>
      <RNView style={styles.listHeading}><Text style={[styles.sectionTitle, { color: colors.text }]}>On hand ({active.data?.items.length ?? 0})</Text></RNView>
      {Boolean(active.data?.items.length) && <TextInput style={[styles.searchInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundElevated }]} value={search} onChangeText={setSearch} placeholder="Search pantry" placeholderTextColor={colors.textMuted} accessibilityLabel="Search pantry items" />}
      {!items.length ? <RNView style={styles.empty}><Ionicons name="basket-outline" size={42} color={colors.textMuted} /><Text style={[styles.emptyText, { color: colors.textSecondary }]}>{search ? 'No matching items.' : 'Your pantry is empty. Add a few ingredients to get started.'}</Text></RNView> : <RNView style={[styles.list, sheet]}>{items.map((item, index) => {
        const dateStatus = pantryDateStatus(item, today);
        const detail = [item.quantity !== null ? formatIngredientAmount(item.quantity, item.unit) : null, item.location, item.date_value ? `${item.date_kind === 'use_by' ? 'Use by' : 'Best before'} ${item.date_value}` : null].filter(Boolean).join(' · ');
        return <RNView key={item.id} style={[styles.item, { borderColor: colors.hairline }, index > 0 && styles.itemDivided]}>
          <RNView style={styles.itemContent}><Text style={[styles.itemName, { color: colors.text }]}>{item.name}</Text>{Boolean(detail) && <Text accessibilityLabel={spokenQuantity(detail)} style={{ color: dateStatus === 'expired' ? colors.warning : colors.textSecondary, lineHeight: 20 }}>{detail}</Text>}{dateStatus === 'expired' && <Text style={{ color: colors.warning }}>Past date · excluded from recipe search</Text>}{item.notes && <Text style={{ color: colors.textMuted }}>{item.notes}</Text>}</RNView>
          <TouchableOpacity onPress={() => openEditor(item)} style={styles.iconButton} accessibilityLabel={`Edit ${item.name}`}><Ionicons name="pencil-outline" size={19} color={colors.textSecondary} /></TouchableOpacity>
          <TouchableOpacity onPress={() => remove(item)} style={styles.iconButton} accessibilityLabel={`Remove ${item.name}`}><Ionicons name="trash-outline" size={19} color={colors.textMuted} /></TouchableOpacity>
        </RNView>;
      })}</RNView>}
    </ScrollView>}

    <Modal visible={editing !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditing(null)}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.groupedBackground }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + spacing.xxl }]} keyboardShouldPersistTaps="handled">
          <RNView style={styles.formTop}><Text style={[styles.heading, { color: colors.text }]}>{editing === 'new' ? 'Add pantry item' : 'Edit pantry item'}</Text><TouchableOpacity onPress={() => setEditing(null)} accessibilityLabel="Close editor"><Ionicons name="close" size={26} color={colors.text} /></TouchableOpacity></RNView>
          <Text style={[styles.label, { color: colors.text }]}>Name *</Text><TextInput style={[styles.field, { color: colors.text, backgroundColor: colors.backgroundElevated, borderColor: colors.border }]} value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="e.g. Rice" placeholderTextColor={colors.textMuted} maxLength={255} autoFocus accessibilityLabel="Item name" />
          <RNView style={styles.twoColumns}><RNView style={{ flex: 1 }}><Text style={[styles.label, { color: colors.text }]}>Amount</Text><TextInput style={[styles.field, { color: colors.text, backgroundColor: colors.backgroundElevated, borderColor: colors.border }]} value={form.quantity ?? ''} onChangeText={(quantity) => setForm({ ...form, quantity: quantity || null })} keyboardType="decimal-pad" placeholder="Optional" placeholderTextColor={colors.textMuted} accessibilityLabel="Item amount" /></RNView><RNView style={{ flex: 1 }}><Text style={[styles.label, { color: colors.text }]}>Unit</Text><TextInput style={[styles.field, { color: colors.text, backgroundColor: colors.backgroundElevated, borderColor: colors.border }]} value={form.unit ?? ''} onChangeText={(unit) => setForm({ ...form, unit: unit || null })} placeholder="cups, lb, etc." placeholderTextColor={colors.textMuted} maxLength={50} accessibilityLabel="Item unit" /></RNView></RNView>
          <Text style={[styles.label, { color: colors.text }]}>Stored in</Text><TextInput style={[styles.field, { color: colors.text, backgroundColor: colors.backgroundElevated, borderColor: colors.border }]} value={form.location ?? ''} onChangeText={(location) => setForm({ ...form, location: location || null })} placeholder="Pantry, fridge, freezer…" placeholderTextColor={colors.textMuted} maxLength={50} accessibilityLabel="Storage location" />
          <Text style={[styles.label, { color: colors.text }]}>Date type</Text><RNView style={styles.twoColumns}>{([null, 'best_before', 'use_by'] as const).map((kind) => <TouchableOpacity key={kind ?? 'none'} onPress={() => { setForm({ ...form, date_kind: kind }); if (!kind) setDateText(''); }} style={[styles.dateChoice, { backgroundColor: form.date_kind === kind ? colors.ink : colors.backgroundElevated, borderColor: form.date_kind === kind ? colors.ink : colors.border }]}><Text style={{ color: form.date_kind === kind ? colors.onInk : colors.text }}>{kind === null ? 'None' : kind === 'best_before' ? 'Best before' : 'Use by'}</Text></TouchableOpacity>)}</RNView>
          {form.date_kind && <><Text style={[styles.label, { color: colors.text }]}>Date</Text><RNView style={styles.twoColumns}>{[{ label: 'Today', days: 0 }, { label: 'In 3 days', days: 3 }, { label: 'In 1 week', days: 7 }].map((choice) => <TouchableOpacity key={choice.days} onPress={() => { const value = new Date(); value.setDate(value.getDate() + choice.days); setDateText(pantryDateForEntry(`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`)); }} style={[styles.dateChoice, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}><Text style={{ color: colors.text }}>{choice.label}</Text></TouchableOpacity>)}</RNView><TextInput style={[styles.field, { color: colors.text, backgroundColor: colors.backgroundElevated, borderColor: colors.border }]} value={dateText} onChangeText={setDateText} placeholder="MM/DD/YYYY" placeholderTextColor={colors.textMuted} keyboardType="numbers-and-punctuation" maxLength={10} accessibilityLabel="Pantry item date" /></>}
          <Text style={[styles.label, { color: colors.text }]}>Notes</Text><TextInput style={[styles.field, { color: colors.text, backgroundColor: colors.backgroundElevated, borderColor: colors.border }]} value={form.notes ?? ''} onChangeText={(notes) => setForm({ ...form, notes: notes || null })} placeholder="Optional" placeholderTextColor={colors.textMuted} maxLength={255} accessibilityLabel="Pantry item notes" />
          <TouchableOpacity onPress={save} disabled={write.isPending} style={[styles.primary, { backgroundColor: colors.tint }]}><Text style={[styles.primaryText, { color: colors.onTint }]}>{write.isPending ? 'Saving…' : 'Save item'}</Text></TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  </RNView>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  content: { paddingHorizontal: layout.margin, paddingTop: spacing.sm, gap: spacing.md },
  intro: { gap: spacing.xs }, heading: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold },
  subheading: { fontSize: fontSize.md, lineHeight: 22 },
  primary: { minHeight: 50, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  primaryText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  notice: { borderRadius: radius.md, flexDirection: 'row', padding: spacing.md, gap: spacing.sm, alignItems: 'flex-start' },
  noticeText: { flex: 1, lineHeight: 20 },
  personal: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  personalActions: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' },
  addBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  quickInput: { flex: 1, minHeight: 52, maxHeight: 110, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fontSize.md },
  addButton: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  textButton: { minHeight: 44, justifyContent: 'center' },
  listHeading: { paddingTop: spacing.sm },
  searchInput: { minHeight: 46, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: fontSize.md },
  list: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  item: { paddingLeft: spacing.md, paddingRight: spacing.xs, paddingVertical: 12, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  itemDivided: { borderTopWidth: StyleSheet.hairlineWidth },
  itemContent: { flex: 1, gap: 2 }, itemName: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  iconButton: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center' },
  empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.md }, emptyText: { textAlign: 'center', lineHeight: 22 },
  form: { padding: layout.margin, gap: spacing.sm }, formTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, marginTop: spacing.sm },
  field: { minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: fontSize.md },
  twoColumns: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  dateChoice: { minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
});
