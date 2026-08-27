import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View as RNView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, useColors } from '@/components/Themed';
import { fontSize, fontWeight, radius, spacing } from '@/constants/Colors';
import { CHAT_MESSAGE_MAX_CHARS } from '../lib/chatComposer';

interface ChatComposerProps {
  conversationKey: string | null;
  text: string;
  attachedImageUri: string | null;
  isListening: boolean;
  isSending: boolean;
  isUnavailable: boolean;
  isGeneralMode: boolean;
  onChangeText: (text: string) => void;
  onSend: () => void;
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
  onChangeText,
  onSend,
  onTakePhoto,
  onPickImage,
  onRemoveImage,
  onMicPress,
  onNativePaste,
  onFallbackPaste,
}: ChatComposerProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const canSend = Boolean(text.trim() || attachedImageUri) && !isUnavailable;
  const showNativePaste = Platform.OS === 'ios' && Clipboard.isPasteButtonAvailable;

  useEffect(() => {
    setAttachmentsOpen(false);
  }, [conversationKey]);

  const runAttachmentAction = (action: () => void) => {
    setAttachmentsOpen(false);
    action();
  };

  return (
    <RNView
      style={[
        styles.composer,
        {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          paddingBottom: insets.bottom + spacing.sm,
        },
      ]}
    >
      {attachedImageUri && (
        <RNView
          style={[
            styles.attachedImageContainer,
            { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
          ]}
        >
          <RNView>
            <Image source={{ uri: attachedImageUri }} style={styles.attachedImagePreview} />
            <TouchableOpacity
              style={[styles.removeImageButton, { backgroundColor: colors.error }]}
              onPress={onRemoveImage}
              accessibilityRole="button"
              accessibilityLabel="Remove attached photo"
              hitSlop={8}
            >
              <Ionicons name="close" size={15} color="#FFFFFF" />
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
          style={[styles.attachmentTray, { backgroundColor: colors.card, borderColor: colors.border }]}
          accessibilityRole="toolbar"
          accessibilityLabel="Attachment options"
        >
          <AttachmentAction
            icon="camera-outline"
            label="Camera"
            accessibilityLabel="Take a photo"
            disabled={isUnavailable}
            onPress={() => runAttachmentAction(onTakePhoto)}
          />
          <AttachmentAction
            icon="images-outline"
            label="Photos"
            accessibilityLabel="Attach photo from library"
            disabled={isUnavailable}
            onPress={() => runAttachmentAction(onPickImage)}
          />
          {!showNativePaste && (
            <AttachmentAction
              icon="clipboard-outline"
              label="Paste"
              accessibilityLabel="Paste from clipboard"
              disabled={isUnavailable}
              onPress={() => runAttachmentAction(onFallbackPaste)}
            />
          )}
        </RNView>
      )}

      <RNView style={styles.inputRow}>
        <TouchableOpacity
          onPress={() => setAttachmentsOpen((open) => !open)}
          disabled={isUnavailable}
          accessibilityRole="button"
          accessibilityLabel={attachmentsOpen ? 'Close attachment options' : 'Add attachment'}
          accessibilityState={{ disabled: isUnavailable, expanded: attachmentsOpen }}
          hitSlop={4}
          style={[
            styles.roundButton,
            {
              backgroundColor: attachmentsOpen ? colors.tint : colors.backgroundSecondary,
              borderColor: attachmentsOpen ? colors.tint : colors.border,
            },
          ]}
        >
          <Ionicons
            name={attachmentsOpen ? 'close' : 'add'}
            size={24}
            color={attachmentsOpen ? '#FFFFFF' : colors.textSecondary}
          />
        </TouchableOpacity>

        <RNView style={styles.inputColumn}>
          <TextInput
            value={text}
            onChangeText={onChangeText}
            placeholder={attachedImageUri
              ? 'Add a message (optional)…'
              : isListening
                ? 'Listening…'
                : isGeneralMode
                  ? 'Ask anything about cooking…'
                  : 'Ask about this recipe…'}
            placeholderTextColor={isListening ? colors.error : colors.textMuted}
            multiline
            maxLength={CHAT_MESSAGE_MAX_CHARS}
            editable={!isUnavailable}
            accessibilityLabel="Message"
            accessibilityHint="Enter a cooking question or instruction"
            style={[
              styles.input,
              {
                backgroundColor: colors.backgroundSecondary,
                borderColor: isListening ? colors.error : colors.border,
                color: colors.text,
              },
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

        {showNativePaste && (
          <RNView
            pointerEvents={isUnavailable ? 'none' : 'auto'}
            style={{ opacity: isUnavailable ? 0.45 : 1 }}
          >
            <Clipboard.ClipboardPasteButton
              acceptedContentTypes={['plain-text', 'image']}
              imageOptions={{ format: 'jpeg', jpegQuality: 0.75 }}
              displayMode="iconOnly"
              cornerStyle="capsule"
              backgroundColor={colors.backgroundSecondary}
              foregroundColor={colors.textSecondary}
              onPress={onNativePaste}
              style={styles.nativePasteButton}
              accessibilityLabel="Paste from clipboard"
              accessibilityState={{ disabled: isUnavailable }}
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
            {
              backgroundColor: isListening ? colors.error : colors.backgroundSecondary,
              borderColor: isListening ? colors.error : colors.border,
            },
          ]}
        >
          <Ionicons
            name={isListening ? 'mic' : 'mic-outline'}
            size={20}
            color={isListening ? '#FFFFFF' : colors.textSecondary}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onSend}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend, busy: isSending }}
          hitSlop={4}
          style={[
            styles.sendButton,
            { backgroundColor: canSend ? colors.tint : colors.border },
          ]}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons
              name="arrow-up"
              size={21}
              color={canSend ? '#FFFFFF' : colors.textMuted}
            />
          )}
        </TouchableOpacity>
      </RNView>
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
      <RNView style={[styles.attachmentActionIcon, { backgroundColor: colors.backgroundSecondary }]}>
        <Ionicons name={icon} size={22} color={colors.tint} />
      </RNView>
      <Text style={[styles.attachmentActionLabel, { color: colors.textSecondary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  composer: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  attachedImageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderWidth: 1,
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
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.lg,
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
  input: {
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingTop: 11,
    paddingBottom: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
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
    width: 40,
    height: 40,
    marginBottom: 2,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  nativePasteButton: {
    width: 40,
    height: 40,
    marginBottom: 2,
  },
  sendButton: {
    width: 40,
    height: 40,
    marginBottom: 2,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
