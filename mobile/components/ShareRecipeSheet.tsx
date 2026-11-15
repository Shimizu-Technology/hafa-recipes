import { useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, View as RNView, useWindowDimensions } from 'react-native';
import { useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Button, Text, TextScaleContext, useColors } from '@/components/Themed';
import { RecipeDetailRow } from '@/components/RecipeDetailRow';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import { ToastHost } from '@/components/Toast';
import { fontFamily, radius, spacing } from '@/constants/Colors';
import { useRecipeShareLink } from '@/hooks/useRecipeShareLink';
import {
  formatLinkCreated,
  formatRecipeShareText,
  getRecipeShareMode,
  getShareFootnote,
  getShareSheetModel,
  getSourceCredit,
  resolveLinkRequest,
} from '@/lib/recipeShare';
import { showToast } from '@/lib/toast';
import { haptics } from '@/utils/haptics';
import type { Recipe } from '@/types/recipe';

type Confirm = { kind: 'create' | 'replace-missing' | 'rotate' | 'revoke'; intent?: 'send' | 'copy' };

const CONFIRM_COPY: Record<Confirm['kind'], { title: string; message: string; action: string; destructive?: boolean }> = {
  create: {
    title: 'Send a private link?',
    message: 'Anyone with this link can open it. It won’t appear in Discover. You can turn the link off at any time.',
    action: 'Create link',
  },
  'replace-missing': {
    title: 'Make a new link?',
    message: 'This phone doesn’t have the current link, and Håfa only shows a link once. A new link replaces it, so the link you sent before will stop opening.',
    action: 'Make a new link',
  },
  rotate: {
    title: 'Replace this link?',
    message: 'The current link stops opening right away. You’ll get a new link to send.',
    action: 'Replace link',
  },
  revoke: {
    title: 'Turn off this link?',
    message: 'People you sent it to won’t be able to open the recipe. Previews already in chats may still show the title and photo.',
    action: 'Turn off link',
    destructive: true,
  },
};

type Props = {
  recipe: Recipe;
  isOwner: boolean;
  visible: boolean;
  onClose: () => void;
  /** Servings currently shown on the recipe, when the reader has scaled it. */
  scaledServings?: number | null;
};

/** App-drawn share sheet: a preview, Send link, then Copy link, Send as text and the original source. */
export function ShareRecipeSheet({ recipe, isOwner, visible, onClose, scaledServings }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const mode = getRecipeShareMode(recipe, isOwner);
  const link = useRecipeShareLink(recipe.id, visible && mode === 'private');
  const linkState = { loading: link.isLoading, unavailable: link.isUnavailable, active: link.active, url: link.url };
  const model = getShareSheetModel(mode, linkState);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const original = recipe.extracted.servings;
  const scaled = original && scaledServings && scaledServings !== original ? scaledServings : null;
  // Text follows what the reader is looking at: a scaled recipe starts on its scaled servings.
  const [useScaled, setUseScaled] = useState(!!scaled);
  useEffect(() => {
    if (visible) setUseScaled(!!scaled);
    else setConfirm(null);
    // Reset each time the sheet opens, not while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  // Another screen opening (a tapped link, a notification) hides this one; don't leave the sheet over it.
  const navigation = useNavigation();
  useEffect(() => (visible ? navigation.addListener('blur', onClose) : undefined), [visible, navigation, onClose]);
  // At accessibility text sizes the card drops to title and credit, and Send link comes right after it.
  const { fontScale } = useWindowDimensions();
  const large = fontScale * useContext(TextScaleContext) >= 1.6;
  const source = getSourceCredit(recipe.source_url, recipe.source_type);
  const contributorName = !isOwner ? recipe.extractor_display_name?.trim() || null : null;
  const credit = [contributorName && `Recipe by ${contributorName}`, source?.label].filter(Boolean).join(' · ');
  const facts = [original ? `Serves ${useScaled && scaled ? scaled : original}` : null, recipe.extracted.times?.total].filter(Boolean).join(' · ');
  const footnote = link.isUnavailable && mode === 'private'
    ? 'Private links aren’t available yet. You can send it as text.'
    : getShareFootnote(mode, { linkActive: link.active, contributorName });

  // Close once something was actually sent; a dismissed system sheet returns here.
  const finish = (result: { action: string }) => { if (result.action === Share.sharedAction) onClose(); };

  const deliver = async (url: string, intent: 'send' | 'copy') => {
    if (intent === 'copy') {
      await Clipboard.setStringAsync(url);
      haptics.success();
      showToast({ message: 'Link copied', tone: 'success' });
      return;
    }
    // iOS builds one rich preview from a lone URL; Android needs the link inside the message.
    finish(await Share.share(Platform.OS === 'ios' ? { url } : { message: `${recipe.extracted.title}\n${url}`, title: recipe.extracted.title }));
  };

  const requestLink = async (intent: 'send' | 'copy') => {
    const request = resolveLinkRequest(mode, recipe.id, linkState);
    if (request.kind === 'ready') {
      await deliver(request.url, intent).catch(() => undefined);
    } else if (request.kind === 'confirm-create') {
      setConfirm({ kind: 'create', intent });
    } else if (request.kind === 'confirm-replace') {
      setConfirm({ kind: 'replace-missing', intent });
    }
  };

  const sendText = async () => {
    const shareLink = resolveLinkRequest(mode, recipe.id, linkState);
    const message = formatRecipeShareText(recipe, {
      servings: useScaled ? scaled : null,
      link: shareLink.kind === 'ready' ? shareLink.url : null,
      contributorName,
    });
    await Share.share({ message }).then(finish, () => undefined);
  };

  const sendOriginal = async () => {
    if (!source) return;
    const by = source.handle ? ` by ${source.handle}` : '';
    await Share.share({ message: `${recipe.extracted.title}, original${by}:\n${source.url}` }).then(finish, () => undefined);
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'revoke') {
        await link.revoke();
        setConfirm(null);
        showToast({ message: 'Link turned off', tone: 'success' });
        return;
      }
      const { stored } = await link.create.mutateAsync(undefined);
      setConfirm(null);
      if (confirm.intent) await deliver(stored.url, confirm.intent).catch(() => undefined);
      else showToast({ message: 'New link ready', tone: 'success' });
    } catch {
      showToast({
        message: confirm.kind === 'revoke' ? 'Couldn’t turn off the link. Try again.' : 'Couldn’t create the link. Try again.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmCopy = confirm ? CONFIRM_COPY[confirm.kind] : null;
  const linkChecking = mode === 'private' && link.isLoading;
  const hasSendText = model.primary === 'send-link';
  const primaryButton = model.primary === 'send-link'
    ? <Button title={linkChecking ? 'Checking link…' : 'Send link'} onPress={() => void requestLink('send')} loading={linkChecking} />
    : <Button title="Send as text" onPress={() => void sendText()} />;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={confirm ? () => setConfirm(null) : onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessible={false}>
        <Pressable accessible={false} onPress={event => event.stopPropagation()}
          style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.hairline, paddingBottom: insets.bottom + spacing.md }]}>
          <RNView style={styles.grabberRow}><RNView style={[styles.grabber, { backgroundColor: colors.border }]} /></RNView>
          <RNView style={styles.header}>
            <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={[styles.heading, { color: colors.text }]}>{confirmCopy ? confirmCopy.title : 'Share recipe'}</Text>
            <Pressable onPress={confirm ? () => setConfirm(null) : onClose} hitSlop={8} style={styles.close}
              accessibilityRole="button" accessibilityLabel={confirm ? 'Back' : 'Close'}>
              <Ionicons name={confirm ? 'arrow-back' : 'close'} size={22} color={colors.textSecondary} />
            </Pressable>
          </RNView>

          <ScrollView bounces={false} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <RNView testID="share-preview" style={[styles.card, { backgroundColor: colors.backgroundElevated, borderColor: colors.hairline }]}>
              {!large && <RecipeThumbnail uri={recipe.thumbnail_url} style={styles.photo} accessible={false} placeholderIconName="restaurant-outline" placeholderIconSize={26} />}
              <RNView style={styles.cardCopy}>
                <Text numberOfLines={large ? undefined : 3} maxFontSizeMultiplier={2} style={[styles.cardTitle, { color: colors.text }]}>{recipe.extracted.title}</Text>
                {facts && !large ? <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>{facts}</Text> : null}
                {credit ? <Text numberOfLines={2} style={[styles.cardMeta, { color: colors.textSecondary }]}>{credit}</Text> : null}
                {!large && <RNView style={styles.cardSite}>
                  <Ionicons name={model.showCopyLink ? 'link' : 'lock-closed-outline'} size={13} color={colors.textMuted} />
                  <Text style={[styles.cardSiteText, { color: colors.textMuted }]}>on Håfa Recipes</Text>
                </RNView>}
              </RNView>
            </RNView>

            {confirmCopy ? (
              <RNView style={styles.confirm}>
                <Text style={[styles.confirmText, { color: colors.text }]}>{confirmCopy.message}</Text>
                <Button title={confirmCopy.action} onPress={runConfirm} loading={busy}
                  style={confirmCopy.destructive ? { backgroundColor: colors.destructive } : undefined} />
                <Button title="Cancel" variant="ghost" onPress={() => setConfirm(null)} disabled={busy} />
              </RNView>
            ) : (
              <>
                {large && primaryButton}
                <Text style={[styles.footnote, { color: colors.textSecondary }]}>{footnote}</Text>
                {scaled ? (
                  <RNView accessibilityRole="radiogroup" style={[styles.segment, { backgroundColor: colors.surface2 }]}>
                    {[false, true].map(option => {
                      const selected = useScaled === option;
                      return (
                        <Pressable key={String(option)} accessibilityRole="radio" accessibilityState={{ selected, checked: selected }}
                          onPress={() => setUseScaled(option)}
                          style={[styles.segmentOption, selected && { backgroundColor: colors.ink }]}>
                          <Text style={[styles.segmentText, { color: selected ? colors.onInk : colors.textSecondary }]}>
                            {option ? `Serves ${scaled}` : `Serves ${original} (original)`}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </RNView>
                ) : null}
                {!large && primaryButton}
                <RNView style={[styles.group, { backgroundColor: colors.backgroundElevated, borderColor: colors.hairline }]}>
                  {model.showCopyLink && <RecipeDetailRow icon="link-outline" title="Copy link" stacked last={!hasSendText && !source}
                    disabled={linkChecking} onPress={() => void requestLink('copy')} />}
                  {hasSendText && <RecipeDetailRow icon="document-text-outline" title="Send as text"
                    value="Ingredients and steps" stacked last={!source} onPress={() => void sendText()} />}
                  {source && <RecipeDetailRow icon="play-circle-outline" title="Original" value={source.label} stacked last
                    accessibilityLabel={`Send the original: ${source.label}`} onPress={() => void sendOriginal()} />}
                </RNView>
                {link.isError && mode === 'private' ? (
                  <Pressable onPress={() => void link.refetch()} accessibilityRole="button" style={styles.statusRow}>
                    <Text style={[styles.status, { color: colors.textSecondary }]}>Couldn’t check this recipe’s link. <Text style={{ color: colors.actionText }}>Try again</Text></Text>
                  </Pressable>
                ) : null}
                {model.showLinkStatus ? (
                  <RNView testID="share-link-status" style={styles.linkStatus}>
                    <RNView style={styles.statusRow}>
                      <RNView style={[styles.dot, { backgroundColor: colors.success }]} />
                      <Text style={[styles.status, { color: colors.text }]}>{formatLinkCreated(link.createdAt)}</Text>
                    </RNView>
                    <Pressable onPress={() => setConfirm({ kind: 'revoke' })} accessibilityRole="button" style={styles.textButton}>
                      <Text style={[styles.textButtonLabel, { color: colors.destructive }]}>Turn off link</Text>
                    </Pressable>
                    <Pressable onPress={() => setConfirm({ kind: 'rotate' })} accessibilityRole="button" style={styles.textButton}>
                      <Text style={[styles.smallLabel, { color: colors.textSecondary }]}>Replace with a new link</Text>
                    </Pressable>
                  </RNView>
                ) : null}
                {link.isRevoking ? <ActivityIndicator color={colors.textSecondary} /> : null}
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
      {/* The Modal draws above the app's toast host, so "Link copied" and errors need one here. */}
      <ToastHost announce={false} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { maxHeight: '92%', borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0 },
  grabberRow: { alignItems: 'center', paddingTop: spacing.sm },
  grabber: { width: 36, height: 5, borderRadius: 3 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: spacing.sm, gap: spacing.sm },
  heading: { flex: 1, fontSize: 20, lineHeight: 25, fontFamily: fontFamily.semibold },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  body: { paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.md },
  card: { flexDirection: 'row', gap: 14, padding: 12, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, alignItems: 'flex-start' },
  photo: { width: 72, height: 72, borderRadius: radius.md, overflow: 'hidden' },
  cardCopy: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 18, lineHeight: 23, fontFamily: fontFamily.recipeTitle },
  cardMeta: { fontSize: 14, lineHeight: 19 },
  cardSite: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  cardSiteText: { fontSize: 13, lineHeight: 18 },
  footnote: { fontSize: 14, lineHeight: 20 },
  segment: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: radius.md, padding: 3, gap: 3 },
  segmentOption: { flexGrow: 1, flexBasis: 120, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 6 },
  segmentText: { fontSize: 15, lineHeight: 20, fontFamily: fontFamily.semibold, textAlign: 'center' },
  group: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  linkStatus: { gap: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { flex: 1, fontSize: 15, lineHeight: 20 },
  textButton: { minHeight: 44, justifyContent: 'center' },
  textButtonLabel: { fontSize: 16, lineHeight: 21, fontFamily: fontFamily.semibold },
  smallLabel: { fontSize: 14, lineHeight: 19, textDecorationLine: 'underline' },
  confirm: { gap: spacing.sm },
  confirmText: { fontSize: 16, lineHeight: 23, marginBottom: spacing.sm },
});
