import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View as RNView,
} from 'react-native';
import { useSignIn } from '@clerk/expo/legacy';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { BrandMark } from '@/components/BrandMark';
import { Button, Input, Text, useColors, View } from '@/components/Themed';
import { fontFamily, fontSize, radius, spacing } from '@/constants/Colors';
import { clerkErrorMessage, shouldNavigateAfterSessionActivation } from '@/lib/accountAccess';
import { sendExistingAccountCode, verifyExistingAccountCode } from '@/lib/accountRecovery';
import { CLERK_ENVIRONMENT } from '@/lib/clerkMigration';

export default function RecoverAccountScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSendCode() {
    if (!isLoaded) return;
    setErrorMessage(null);
    setIsLoading(true);
    try {
      await sendExistingAccountCode(signIn, email);
      setCode('');
      setStep('code');
    } catch (error: unknown) {
      setErrorMessage(clerkErrorMessage(error, 'Could not send a verification code. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerifyCode() {
    if (!isLoaded) return;
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const result = await verifyExistingAccountCode(signIn, code);
      if (result.status === 'complete') {
        await setActive({ session: result.sessionId });
        if (shouldNavigateAfterSessionActivation(CLERK_ENVIRONMENT)) router.replace('/(tabs)');
        return;
      }
      setErrorMessage(result.status === 'needs_second_factor'
        ? 'This account requires a second verification step. Please use your original sign-in method.'
        : 'Could not finish account recovery. Please request a new code and try again.');
    } catch (error: unknown) {
      setErrorMessage(clerkErrorMessage(error, 'That code could not be verified. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: colors.backgroundSecondary }]}
            onPress={() => {
              setErrorMessage(null);
              if (step === 'code') setStep('email');
              else router.back();
            }}
            disabled={isLoading}
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
            <Text style={[styles.backLabel, { color: colors.text }]}>Back</Text>
          </TouchableOpacity>

          <RNView style={styles.header}>
            <BrandMark size={80} style={{ backgroundColor: colors.backgroundSecondary }} />
            <Text style={[styles.eyebrow, { color: colors.tint }]}>Your recipes are safe</Text>
            <Text style={[styles.title, { color: colors.text }]}>
              {step === 'email' ? 'Find your library' : 'Check your email'}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {step === 'email'
                ? 'Use the email address from your existing account. We’ll verify it and bring back your original recipes.'
                : `Enter the six-digit code we sent to ${email.trim()}.`}
            </Text>
          </RNView>

          {errorMessage && (
            <RNView style={[styles.errorBanner, {
              backgroundColor: `${colors.error}15`,
              borderColor: colors.error,
            }]}>
              <Ionicons name="alert-circle-outline" size={19} color={colors.error} />
              <Text style={[styles.errorText, { color: colors.error }]}>{errorMessage}</Text>
            </RNView>
          )}

          <RNView style={styles.form}>
            {step === 'email' ? (
              <>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Account email</Text>
                <Input
                  value={email}
                  onChangeText={(value) => { setEmail(value); setErrorMessage(null); }}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                  onSubmitEditing={() => { if (email.trim()) void handleSendCode(); }}
                  returnKeyType="send"
                />
                <Button
                  title={isLoading ? 'Sending code…' : 'Send verification code'}
                  onPress={() => void handleSendCode()}
                  disabled={isLoading || !email.trim()}
                  loading={isLoading}
                  size="lg"
                />
              </>
            ) : (
              <>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Verification code</Text>
                <Input
                  value={code}
                  onChangeText={(value) => {
                    setCode(value.replace(/\D/g, '').slice(0, 6));
                    setErrorMessage(null);
                  }}
                  placeholder="123456"
                  keyboardType="number-pad"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                  maxLength={6}
                  autoFocus
                />
                <Button
                  title={isLoading ? 'Verifying…' : 'Restore my recipes'}
                  onPress={() => void handleVerifyCode()}
                  disabled={isLoading || code.length !== 6}
                  loading={isLoading}
                  size="lg"
                />
                <Button
                  title="Send another code"
                  onPress={() => void handleSendCode()}
                  disabled={isLoading}
                  variant="ghost"
                />
              </>
            )}
          </RNView>

          <RNView style={[styles.note, {
            backgroundColor: colors.backgroundSecondary,
            borderColor: colors.border,
          }]}>
            <Ionicons name="shield-checkmark-outline" size={19} color={colors.accent} />
            <Text style={[styles.noteText, { color: colors.textSecondary }]}>
              This only restores an existing account. It never creates a new library or changes who owns your recipes.
            </Text>
          </RNView>

          {step === 'email' && (
            <RNView style={[styles.appleNote, { borderColor: colors.border }]}>
              <Ionicons name="logo-apple" size={18} color={colors.text} />
              <RNView style={styles.appleNoteCopy}>
                <Text style={[styles.appleNoteTitle, { color: colors.text }]}>
                  Previously used Hide My Email?
                </Text>
                <Text style={[styles.noteText, { color: colors.textSecondary }]}>
                  Find your Håfa Recipes relay address in your Apple Account’s Sign in with Apple settings. Verification codes sent there are forwarded to your inbox.
                </Text>
              </RNView>
            </RNView>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: spacing.lg },
  backButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.md,
    flexDirection: 'row',
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  backLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.md },
  header: { alignItems: 'center', marginBottom: spacing.xl },
  eyebrow: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.xs,
    letterSpacing: 1.1,
    marginTop: spacing.lg,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.xxl,
    marginTop: spacing.sm,
  },
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    lineHeight: 22,
    marginTop: spacing.sm,
    maxWidth: 335,
    textAlign: 'center',
  },
  errorBanner: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  errorText: { flex: 1, fontFamily: fontFamily.medium, fontSize: fontSize.sm },
  form: { gap: spacing.md, marginBottom: spacing.xl },
  label: { fontFamily: fontFamily.medium, fontSize: fontSize.sm },
  note: {
    alignItems: 'flex-start',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  noteText: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.sm, lineHeight: 19 },
  appleNote: {
    alignItems: 'flex-start',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
  },
  appleNoteCopy: { flex: 1, gap: spacing.xs },
  appleNoteTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.sm },
});
