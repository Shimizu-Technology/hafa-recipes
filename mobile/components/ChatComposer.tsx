import { TextInput } from '@/components/Themed';
import React, { useEffect, useState } from 'react';
import {
  Image,
  Platform,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View as RNView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, useColors } from '@/components/Themed';
import { fontFamily, fontSize, fontWeight, radius, spacing } from '@/constants/Colors';
import { CHAT_MESSAGE_MAX_CHARS } from '../lib/chatComposer';

interface ChatComposerProps {
  conversationKey: string | null;
  text: string;
  attachedImageUri: string | null;
  isListening: boolean;
  isSending: boolean;
  isUnavailable: boolean;
  isGeneralMode: boolean;
  /** What the assistant is looking at, shown above the field (for example "All recipes"). */
  context?: React.ReactNode;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onCancel: () => void;
  onTakePhoto: () => void;
  onPickImage: () => void;
  onRemoveImage: () => void;
  onMicPress: () => void;
  onNativePaste: (payload: Clipboard.PasteEventPayload) => void;
  onFallbackPaste: () => void;
}

/** Compact, accessible chat composer with expandable attachments and native paste. */
export default function ChatComposer({
  conversationKey,
  text,
  attachedImageUri,
  isListening,
  isSending,
  isUnavailable,
  isGeneralMode,
  context,
  onChangeText,
  onSend,
  onCancel,
  onTakePhoto,
  onPickImage,
  onRemoveImage,
  onMicPress,
  onNativePaste,
  onFallbackPaste,
}: ChatComposerProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  // At larger text the field gets its own row so the placeholder stays readable.
  const largeText = fontScale >= 1.3;
  // The placeholder follows the text actually drawn (system × in-app size); the layout gate stays system-only.
  // UIPasteControl hides its icon when its frame is smaller than the scaled glyph,
  // which left a blank tinted square at larger text; size it, and the buttons
  // beside it, to the font scale.
  const controlSize = Math.max(44, Math.ceil(44 * fontScale));
  const controlFrame = { width: controlSize, height: controlSize };
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const areAttachmentsDisabled = isUnavailable || isListening;
  const canSend = Boolean(text.trim() || attachedImageUri) && !isUnavailable && !isListening;
  const canPressPrimary = isSending || canSend;
  const showNativePaste = Platform.OS === 'ios' && Clipboard.isPasteButtonAvailable;

  useEffect(() => {
    setAttachmentsOpen(false);
  }, [conversationKey]);

  const runAttachmentAction = (action: () => void) => {
    if (areAttachmentsDisabled) return;
    setAttachmentsOpen(false);
    action();
  };

  const messageInput = (
    <RNView style={[styles.inputColumn, largeText && styles.inputColumnFullWidth]}>
      <TextInput
        value={text}
        onChangeText={onChangeText}
        placeholder={attachedImageUri
          ? 'Add a message (optional)…'
          : isListening
            ? 'Listening…'
            : isGeneralMode
              // Short enough to stay on one line beside +, paste and the mic at every text size.
              ? 'Ask about cooking…'
              : 'Ask about this recipe…'}
        placeholderTextColor={isListening ? colors.actionText : colors.textMuted}
        multiline
        maxLength={CHAT_MESSAGE_MAX_CHARS}
        editable={!isUnavailable && !isListening}
        accessibilityLabel="Message"
        accessibilityHint="Enter a cooking question or instruction"
        style={[
          styles.input,
          { color: colors.text },
        ]}
        returnKeyType="send"
        blurOnSubmit={false}
        onSubmitEditing={onSend}
      />
      {text.length >= CHAT_MESSAGE_MAX_CHARS - 400 && (
        <Text
          style={[styles.characterCount, { color: colors.textMuted }]}
          accessibilityLiveRegion="polite"
        >
          {text.length.toLocaleString()} / {CHAT_MESSAGE_MAX_CHARS.toLocaleString()}
        </Text>
      )}
    </RNView>
  );

  return (
    <RNView
      style={[
        styles.composer,
        {
          backgroundColor: colors.background,
          borderTopColor: colors.hairline,
          paddingBottom: insets.bottom + spacing.sm,
        },
      ]}
    >
      {context}
      {attachedImageUri && (
        <RNView
          style={[
            styles.attachedImageContainer,
            { backgroundColor: colors.backgroundElevated, borderColor: colors.hairline },
          ]}
        >
          <RNView>
            <Image source={{ uri: attachedImageUri }} style={styles.attachedImagePreview} />
            <TouchableOpacity
              style={[styles.removeImageButton, { backgroundColor: colors.error }]}
              onPress={() => {
                if (!areAttachmentsDisabled) onRemoveImage();
              }}
              disabled={areAttachmentsDisabled}
              accessibilityRole="button"
              accessibilityLabel="Remove attached photo"
              accessibilityState={{ disabled: areAttachmentsDisabled }}
              hitSlop={8}
            >
              <Ionicons name="close" size={15} color={colors.onError} />
            </TouchableOpacity>
          </RNView>
          <RNView style={styles.attachedImageText}>
            <Text style={[styles.attachedImageTitle, { color: colors.text }]}>Photo ready</Text>
            <Text style={[styles.attachedImagePrivacyNotice, { color: colors.textMuted }]}>
              Sent to our AI provider and stored with this chat. Don&apos;t upload sensitive personal information.
            </Text>
          </RNView>
        </RNView>
      )}

      {attachmentsOpen && (
        <RNView
          style={[styles.attachmentTray, { backgroundColor: colors.backgroundElevated, borderColor: colors.hairline }]}
          accessibilityRole="toolbar"
          accessibilityLabel="Attachment options"
        >
          <AttachmentAction
            icon="camera-outline"
            label="Camera"
            accessibilityLabel="Take a photo"
            disabled={areAttachmentsDisabled}
            onPress={() => runAttachmentAction(onTakePhoto)}
          />
          <AttachmentAction
            icon="images-outline"
            label="Photos"
            accessibilityLabel="Attach photo from library"
            disabled={areAttachmentsDisabled}
            onPress={() => runAttachmentAction(onPickImage)}
          />
          {!showNativePaste && (
            <AttachmentAction
              icon="clipboard-outline"
              label="Paste"
              accessibilityLabel="Paste from clipboard"
              disabled={areAttachmentsDisabled}
              onPress={() => runAttachmentAction(onFallbackPaste)}
            />
          )}
        </RNView>
      )}

      {isListening && (
        <RNView
          style={[styles.listeningStatus, { backgroundColor: `${colors.tint}14` }]}
          accessibilityLiveRegion="polite"
        >
          <RNView style={[styles.listeningDot, { backgroundColor: colors.tint }]} />
          <Text style={[styles.listeningText, { color: colors.actionText }]}>Listening…</Text>
          <Text style={[styles.listeningHint, { color: colors.textSecondary }]}>Tap the mic when done</Text>
        </RNView>
      )}

      {/* One field holds +, the message, paste and the mic; Send sits beside it as the only accent. */}
      <RNView style={styles.inputRow}>
      <RNView style={[styles.field, { backgroundColor: colors.backgroundElevated, borderColor: isListening ? colors.tint : colors.border }]}>
      {largeText && <RNView style={[styles.inputRow, styles.largeTextInputRow]}>{messageInput}</RNView>}
      <RNView style={styles.fieldRow}>
        <TouchableOpacity
          onPress={() => {
            if (!areAttachmentsDisabled) setAttachmentsOpen((open) => !open);
          }}
          disabled={areAttachmentsDisabled}
          accessibilityRole="button"
          accessibilityLabel={attachmentsOpen ? 'Close attachment options' : 'Add attachment'}
          accessibilityState={{ disabled: areAttachmentsDisabled, expanded: attachmentsOpen }}
          hitSlop={4}
          style={[
            styles.roundButton,
            controlFrame,
            { backgroundColor: attachmentsOpen ? colors.surface2 : 'transparent' },
          ]}
        >
          <Ionicons
            name={attachmentsOpen ? 'close' : 'add'}
            size={24}
            color={attachmentsOpen ? colors.text : colors.textSecondary}
          />
        </TouchableOpacity>

        {largeText ? <RNView style={styles.controlSpacer} /> : messageInput}

        {showNativePaste && (
          <RNView
            pointerEvents={areAttachmentsDisabled ? 'none' : 'auto'}
            style={{ opacity: areAttachmentsDisabled ? 0.45 : 1 }}
          >
            {/* Remount so the native control re-lays out its glyph for the new size. */}
            <Clipboard.ClipboardPasteButton
              key={`paste-${fontScale}`}
              acceptedContentTypes={['plain-text', 'image']}
              imageOptions={{ format: 'jpeg', jpegQuality: 0.75 }}
              displayMode="iconOnly"
              cornerStyle="capsule"
              backgroundColor={colors.backgroundElevated}
              foregroundColor={colors.textSecondary}
              onPress={(payload) => {
                if (!areAttachmentsDisabled) onNativePaste(payload);
              }}
              style={[styles.nativePasteButton, controlFrame]}
              accessibilityLabel="Paste from clipboard"
              accessibilityState={{ disabled: areAttachmentsDisabled }}
            />
          </RNView>
        )}

        <TouchableOpacity
          onPress={onMicPress}
          disabled={isUnavailable}
          accessibilityRole="button"
          accessibilityLabel={isListening ? 'Stop voice input' : 'Start voice input'}
          accessibilityState={{ disabled: isUnavailable, selected: isListening }}
          hitSlop={4}
          style={[
            styles.roundButton,
            controlFrame,
            { backgroundColor: isListening ? colors.tint : 'transparent' },
          ]}
        >
          <Ionicons
            name={isListening ? 'mic' : 'mic-outline'}
            size={20}
            color={isListening ? colors.onTint : colors.textSecondary}
          />
        </TouchableOpacity>
      </RNView>
      </RNView>

        <TouchableOpacity
          onPress={isSending ? onCancel : onSend}
          disabled={!canPressPrimary}
          accessibilityRole="button"
          accessibilityLabel={isSending ? 'Stop generating' : 'Send message'}
          accessibilityState={{ disabled: !canPressPrimary, busy: isSending }}
          hitSlop={4}
          style={[
            styles.sendButton,
            controlFrame,
            {
              backgroundColor: isSending
                ? colors.error
                : canSend
                  ? colors.tint
                  : colors.surface2,
            },
          ]}
        >
          {isSending ? (
            <Ionicons name="stop" size={18} color={colors.onError} />
          ) : (
            <Ionicons
              name="arrow-up"
              size={21}
              color={canSend ? colors.onTint : colors.textMuted}
            />
          )}
        </TouchableOpacity>
      </RNView>
      <Text style={[styles.aiNote, { color: colors.textMuted }]}>
        Håfa can make mistakes. Double-check food-safety guidance.
      </Text>
    </RNView>
  );
}

interface AttachmentActionProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}

function AttachmentAction({
  icon,
  label,
  accessibilityLabel,
  disabled,
  onPress,
}: AttachmentActionProps) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={[styles.attachmentAction, { opacity: disabled ? 0.45 : 1 }]}
    >
      <RNView style={[styles.attachmentActionIcon, { backgroundColor: colors.surface2 }]}>
        <Ionicons name={icon} size={22} color={colors.text} />
      </RNView>
      <Text style={[styles.attachmentActionLabel, { color: colors.textSecondary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  aiNote: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    lineHeight: 15,
    textAlign: 'center',
  },
  attachedImageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    gap: spacing.md,
  },
  attachedImagePreview: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
  },
  removeImageButton: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    top: -spacing.xs,
    right: -spacing.xs,
  },
  attachedImageText: {
    flex: 1,
    gap: 2,
  },
  attachedImageTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  attachedImagePrivacyNotice: {
    fontSize: fontSize.xs,
    lineHeight: 16,
  },
  attachmentTray: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.lg,
  },
  listeningStatus: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  listeningDot: {
    borderRadius: radius.full,
    height: 7,
    width: 7,
  },
  listeningText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  listeningHint: {
    fontSize: fontSize.xs,
  },
  attachmentAction: {
    minWidth: 58,
    alignItems: 'center',
    gap: spacing.xs,
  },
  attachmentActionIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentActionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  inputColumn: {
    flex: 1,
  },
  field: {
    flex: 1,
    minHeight: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  input: {
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: spacing.xs,
    paddingTop: 11,
    paddingBottom: 10,
    fontSize: fontSize.md,
    lineHeight: 21,
    textAlignVertical: 'center',
  },
  characterCount: {
    marginTop: 2,
    marginRight: spacing.xs,
    fontSize: fontSize.xs,
    textAlign: 'right',
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  largeTextInputRow: {
    marginBottom: spacing.sm,
  },
  inputColumnFullWidth: {
    flexBasis: '100%',
  },
  controlSpacer: {
    flex: 1,
  },
  nativePasteButton: {
    width: 44,
    height: 44,
    marginBottom: 2,
  },
  sendButton: {
    width: 44,
    height: 44,
    marginBottom: 2,
    marginLeft: spacing.xs,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
