import { useEffect, useRef, useState } from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useColorScheme, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Image } from "expo-image";
import { Stack } from "expo-router";
import { friendlyTime } from "@/lib/care-format";
import { useBaby } from "@/lib/context";
import type { EditorDraft } from "@/lib/models";
import { titleLimit } from "../lib/journal-title";
import { DateField } from "./date-field";
import { Button, Copy, Icon, Notice, PressTarget, TopBar, fonts, radii, sectionHeadingLimit, typeScale, useColors, type IconName } from "./ui";

export type AttachKind = "photo" | "camera" | "document";
const pageInk = { fontSize: 18, lineHeight: 27, fontFamily: fonts.regular };
/** A title at the largest text would fill the page before she'd written a word. */
const titleTextLimit = 1.6;
/** From this size the date's words don't fit beside Save, so it's a calendar that says them when tapped. */
const dateWordsFit = 1.35;

/** The page before the draft has loaded. A header here would only be there for a moment and then go. */
export function ComposerOpening() {
  const c = useColors();
  return <View style={{ flex: 1, backgroundColor: c.background }}><Stack.Screen options={{ headerShown: false }} /></View>;
}
/** A photo saved earlier, which only a signed-in request can read. */
function SavedThumb({ id }: { id: string }) {
  const b = useBaby(), c = useColors(), [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  useEffect(() => {
    let active = true;
    void b.api.attachment(id).then(async (item) => {
      const token = item.mime_type.startsWith("image/") ? await b.getToken() : null;
      if (active && token) setSource({ uri: b.api.attachmentUrl(id), headers: { Authorization: `Bearer ${token}`, ...b.api.fileHeaders() } });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [id]);
  return source ? <Image source={source} cachePolicy="none" contentFit="cover" style={{ flex: 1 }} onError={() => setSource(null)} />
    : <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Icon name="document-outline" color={c.muted} /></View>;
}
function Tile({ label, onRemove, children }: { label: string; onRemove: () => void; children: React.ReactNode }) {
  const c = useColors();
  return <View style={{ width: 96, height: 96 }}>
    <View style={{ flex: 1, borderRadius: radii.thumb, overflow: "hidden", backgroundColor: c.soft }}>{children}</View>
    <PressTarget accessibilityRole="button" accessibilityLabel={`Remove ${label}`} hitSlop={6} onPress={onRemove}
      style={{ position: "absolute", top: -6, right: -6, width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: c.action }}>
        <Icon name="close" size={15} color={c.onAction} />
      </View>
    </PressTarget>
  </View>;
}
function DockButton({ icon, label, badge, onPress }: { icon: IconName; label: string; badge?: number; onPress: () => void }) {
  const c = useColors();
  return <PressTarget accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
    <Icon name={icon} size={23} />
    {!!badge && <View style={{ position: "absolute", top: 3, right: 1, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, alignItems: "center", justifyContent: "center", backgroundColor: c.action }}>
      <Text allowFontScaling={false} style={{ fontFamily: fonts.bold, fontSize: 11, lineHeight: 13, color: c.onAction, fontVariant: ["tabular-nums"] }}>{badge}</Text>
    </View>}
  </PressTarget>;
}

/**
 * Writing, not filling in a form: an optional title in the serif face, then her words down the page. What else an entry
 * can have waits in the dock, which rides on the keyboard with Save, or behind it in the details sheet. `details` is what
 * the sheet holds, and it's what every other kind has on its form, so the rules for each stay in one place.
 */
export function JournalComposer({ draft, change, saved, error, busy, status, details, canDiscard, onAttach, onRemoveFile, onRemoveSaved, onSave, onDiscard }: {
  draft: EditorDraft;
  change: (value: Partial<EditorDraft>) => void;
  /** The draft has reached this phone's storage. */
  saved: boolean;
  error: string;
  busy: boolean;
  /** Who can see this, and for which baby, when there's a choice. A privacy choice mustn't need opening anything to read. */
  status?: string;
  details: React.ReactNode;
  canDiscard: boolean;
  onAttach: (kind: AttachKind) => void;
  onRemoveFile: (id: string) => void;
  onRemoveSaved: (id: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const b = useBaby(), c = useColors(), scheme = useColorScheme(), safeArea = useSafeAreaInsets(), { fontScale } = useWindowDimensions(),
    title = useRef<TextInput>(null), body = useRef<TextInput>(null), scroller = useRef<ScrollView>(null),
    lastFocused = useRef<TextInput | null>(null), everSaved = useRef(false),
    page = useRef({ height: 0, offset: 0, bodyTop: 0, bodyLength: draft.body.length, caretAtEnd: true }),
    [keyboard, setKeyboard] = useState(false), [sheet, setSheet] = useState(false), [picking, setPicking] = useState<Date | null>(null);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboard(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const uploaded = (file: EditorDraft["files"][number]) => file.uploaded_id ?? b.state.fileUploads?.[file.id],
    savedIds = draft.data.attachment_ids ?? [],
    // Once it's uploaded, a new photo is in both lists until the record settles. It's still one photo.
    localFiles = draft.files.filter((file) => { const id = uploaded(file); return !id || !savedIds.includes(id); }),
    count = savedIds.length + localFiles.length,
    shown = useRef(count), roomy = fontScale < dateWordsFit;
  // A photo she's just added can be below a long entry, and she should see it arrive.
  useEffect(() => {
    if (count > shown.current) setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 100);
    shown.current = count;
  }, [count]);
  // It saves in every pause, so once it's been said it stays said. Coming and going with each word would be a flicker to read.
  everSaved.current ||= saved;
  /** iOS follows the caret as keys are typed, but not through a paste or dictation, so those are brought into view here. */
  function followWriting(height: number) {
    const { height: seen, offset, bodyTop, caretAtEnd } = page.current, bottom = bodyTop + height + 12 - seen;
    if (caretAtEnd && seen && bottom > offset && body.current?.isFocused()) scroller.current?.scrollTo({ y: bottom, animated: false });
  }
  /** Sets the keyboard aside for something on top of the page, and remembers where to put it back. */
  function stepAside() {
    lastFocused.current = body.current?.isFocused() ? body.current : title.current?.isFocused() ? title.current : null;
    Keyboard.dismiss();
  }
  function openSheet() {
    stepAside();
    setSheet(true);
  }
  function closeSheet() {
    setSheet(false);
    lastFocused.current?.focus();
  }
  function attach() {
    const kinds: { kind: AttachKind; text: string }[] = [{ kind: "photo", text: "Photo library" }, { kind: "camera", text: "Take a photo" }, { kind: "document", text: "Choose a file" }];
    if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions(
      { options: ["Cancel", ...kinds.map((k) => k.text)], cancelButtonIndex: 0, userInterfaceStyle: scheme === "dark" ? "dark" : "light" },
      (index) => { if (index > 0) onAttach(kinds[index - 1].kind); });
    else Alert.alert("Add to this entry", undefined, kinds.map((k) => ({ text: k.text, onPress: () => onAttach(k.kind) })), { cancelable: true });
  }
  function pickDate() {
    if (Platform.OS === "android") return openSheet();
    stepAside();
    const date = new Date(draft.occurred_at);
    setPicking(Number.isFinite(date.getTime()) ? date : new Date());
  }
  const when = friendlyTime(draft.occurred_at);
  return <SafeAreaView collapsable={false} edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: c.background }}>
    <Stack.Screen options={{ headerShown: false }} />
    <TopBar back close={false} trailing={(!!status || (everSaved.current && roomy)) && <Pressable accessibilityRole="button" accessibilityLabel={[status, everSaved.current ? "Draft saved" : "", "Details"].filter(Boolean).join(". ")} onPress={openSheet}
      style={{ flexShrink: 1, minHeight: 44, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 10 }}>
      {everSaved.current && roomy && <Text key={`s:${fontScale}`} numberOfLines={1} style={{ ...typeScale.caption, color: c.muted }}>Draft saved</Text>}
      {!!status && <Text key={`w:${fontScale}`} numberOfLines={1} maxFontSizeMultiplier={titleTextLimit} style={{ flexShrink: 1, fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, color: c.text }}>{status}</Text>}
    </Pressable>} />
    <KeyboardAvoidingView collapsable={false} behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView ref={scroller} style={{ flex: 1 }} alwaysBounceVertical scrollEventThrottle={64}
        onLayout={(event) => { page.current.height = event.nativeEvent.layout.height; }} onScroll={(event) => { page.current.offset = event.nativeEvent.contentOffset.y; }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
        contentInsetAdjustmentBehavior="never" contentContainerStyle={{ flexGrow: 1, width: "100%", maxWidth: 720, alignSelf: "center", paddingHorizontal: 22, paddingTop: 6 }}>
        {draft.data.provenance === "clinician_instruction" && <View style={{ paddingBottom: 8 }}><Copy kind="small" tone="muted">Clinician instruction · labeled by you</Copy></View>}
        <TextInput key={`t:${fontScale}`} ref={title} accessibilityLabel="Title, optional" value={draft.title} placeholder="Title (optional)" placeholderTextColor={c.muted} selectionColor={c.accentText}
          // Wraps instead of sliding sideways. Return goes on to the entry, and a pasted line break is only a space.
          multiline scrollEnabled={false} submitBehavior="submit" returnKeyType="next" onSubmitEditing={() => body.current?.focus()}
          onChangeText={(text) => change({ title: text.replace(/\s*\n\s*/g, " ") })} maxLength={titleLimit} autoCapitalize="sentences" maxFontSizeMultiplier={titleTextLimit}
          style={{ ...typeScale.title1, padding: 0, color: c.text, textAlignVertical: "top" }} />
        <TextInput key={`b:${fontScale}`} ref={body} accessibilityLabel="Your entry" value={draft.body} placeholder={fontScale >= 2 ? "How are you doing?" : "How are you doing? What would you like to remember?"} placeholderTextColor={c.muted} selectionColor={c.accentText}
          multiline scrollEnabled={false} autoFocus={!draft.existing} maxLength={100000}
          onChangeText={(text) => { page.current.bodyLength = text.length; change({ body: text }); }}
          onSelectionChange={(event) => { page.current.caretAtEnd = event.nativeEvent.selection.end >= page.current.bodyLength; }}
          onLayout={(event) => { page.current.bodyTop = event.nativeEvent.layout.y; }} onContentSizeChange={(event) => followWriting(event.nativeEvent.contentSize.height)} autoCapitalize="sentences" maxFontSizeMultiplier={0}
          style={{ ...pageInk, marginTop: 12, padding: 0, color: c.text, textAlignVertical: "top" }} />
        {count > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, paddingTop: 22 }}>
          {savedIds.map((id, index) => <Tile key={id} label={`saved attachment ${index + 1}`} onRemove={() => onRemoveSaved(id)}><SavedThumb id={id} /></Tile>)}
          {localFiles.map((file) => <Tile key={file.id} label={file.name} onRemove={() => onRemoveFile(file.id)}>
            {file.mime_type.startsWith("image/") ? <Image source={{ uri: file.uri }} accessibilityLabel={file.name} contentFit="cover" style={{ flex: 1 }} />
              : <View style={{ flex: 1, padding: 8, gap: 4, alignItems: "center", justifyContent: "center" }}>
                <Icon name="document-outline" color={c.muted} />
                <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ ...typeScale.caption, color: c.text, textAlign: "center" }}>{file.name}</Text>
              </View>}
          </Tile>)}
        </View>}
        {/* The rest of the page is still the page. */}
        <Pressable accessible={false} onPress={() => body.current?.focus()} style={{ flexGrow: 1, minHeight: 96 }} />
      </ScrollView>
      {!!error && <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}><Notice error>{error}</Notice></View>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingTop: 6, paddingBottom: keyboard ? 6 : Math.max(6, safeArea.bottom),
        borderTopWidth: 0.5, borderColor: c.border, backgroundColor: c.background, width: "100%", maxWidth: 720, alignSelf: "center" }}>
        <DockButton icon="image-outline" label={count ? `Add a photo or file. ${count} added.` : "Add a photo or file"} badge={count} onPress={attach} />
        {roomy
          ? <PressTarget accessibilityRole="button" accessibilityLabel={`Date and time, ${when}`} onPress={pickDate} style={{ flexShrink: 1, minHeight: 44, justifyContent: "center" }}>
            <View style={{ minHeight: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: "center", backgroundColor: c.soft }}>
              <Text key={`d:${fontScale}`} numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, color: c.text, fontVariant: ["tabular-nums"] }}>{when}</Text>
            </View>
          </PressTarget>
          : <DockButton icon="calendar-outline" label={`Date and time, ${when}`} onPress={pickDate} />}
        <DockButton icon="ellipsis-horizontal" label="Details" onPress={openSheet} />
        <View style={{ flex: 1 }} />
        <PressTarget accessibilityRole="button" accessibilityLabel={draft.existing ? "Save changes" : "Save journal entry"} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onSave}
          style={{ minHeight: 44, paddingHorizontal: 18, paddingVertical: 6, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.action }}>
          {busy ? <ActivityIndicator color={c.onAction} /> : fontScale < 2 && <Icon name="checkmark" size={18} color={c.onAction} />}
          <Text key={`v:${fontScale}`} numberOfLines={1} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, color: c.onAction }}>Save</Text>
        </PressTarget>
      </View>
    </KeyboardAvoidingView>
    {sheet && <Modal transparent animationType="fade" onRequestClose={closeSheet}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: c.scrim }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close details" onPress={closeSheet} style={{ flexGrow: 1, minHeight: 44 }} />
        <View style={{ maxHeight: "88%", borderTopLeftRadius: radii.hero, borderTopRightRadius: radii.hero, backgroundColor: c.background }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, gap: 18 }}>
            {details}
            {Platform.OS === "android" && <DateField label="Date and time" value={draft.occurred_at} onChange={(occurred_at) => change({ occurred_at })} />}
            <Copy kind="small" tone="muted">{everSaved.current ? "Draft saved privately on this device." : "Your draft stays on this device while you write."}</Copy>
            {canDiscard && <Button variant="destructive" title={draft.existing ? "Discard changes" : "Discard this draft"} disabled={busy} onPress={() => { setSheet(false); onDiscard(); }} />}
          </ScrollView>
          <View style={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: Math.max(14, safeArea.bottom) }}>
            <Button secondary title="Done" onPress={closeSheet} />
          </View>
        </View>
      </View>
    </Modal>}
    {!!picking && <Modal transparent animationType="fade" onRequestClose={() => setPicking(null)}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: c.scrim }}>
        <View style={{ gap: 12, padding: 22, paddingBottom: Math.max(14, safeArea.bottom), borderTopLeftRadius: radii.hero, borderTopRightRadius: radii.hero, backgroundColor: c.background }}>
          <Copy kind="heading" limit={sectionHeadingLimit}>Date and time</Copy>
          <DateTimePicker value={picking} mode="datetime" display="spinner" themeVariant={scheme === "dark" ? "dark" : "light"} onChange={(_, date) => { if (date) setPicking(date); }} />
          <Button title="Use this date" onPress={() => { change({ occurred_at: picking.toISOString() }); setPicking(null); lastFocused.current?.focus(); }} />
          <Button secondary title="Cancel" onPress={() => { setPicking(null); lastFocused.current?.focus(); }} />
        </View>
      </View>
    </Modal>}
  </SafeAreaView>;
}
