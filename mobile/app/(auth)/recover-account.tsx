import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
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
import {
  beginExistingAccountPasswordRecovery,
  completeExistingAccountPasswordRecovery,
  isUnknownRecoveryAccountError,
} from '@/lib/accountRecovery';
import { authBackAccessibilityLabel, leaveAuthScreen } from '@/lib/authNavigation';
import { CLERK_ENVIRONMENT } from '@/lib/clerkMigration';

const RESEND_COOLDOWN_SECONDS = 30;
const SUPPORT_URL = 'mailto:shimizutechnology@gmail.com?subject=H%C3%A5fa%20Recipes%20account%20recovery';
const NEUTRAL_CODE_SENT_MESSAGE =
  'If a Håfa account matches this email, a six-digit code is on its way.';

function completionErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'errors' in error && Array.isArray(error.errors)) {
    const code = error.errors[0]?.code;
    if (code === 'form_code_incorrect') {
      return 'That verification code does not match. Check the email and try again.';
    }
    if (code === 'form_password_pwned') {
      return 'That password has appeared in a data breach. Please choose a different password.';
    }
  }
  return clerkErrorMessage(error, 'We could not restore access. Please try again.');
}

export default function RecoverAccountScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [step, setStep] = useState<'email' | 'secure'>('email');
  const [isLoading, setIsLoading] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1_000);
    return () => clearInterval(timer);
  }, [resendSeconds]);

  function clearMessages() {
    setErrorMessage(null);
    setStatusMessage(null);
  }

  function enterSecureStep() {
    setStep('secure');
    setCode('');
    setResendSeconds(RESEND_COOLDOWN_SECONDS);
    setStatusMessage(NEUTRAL_CODE_SENT_MESSAGE);
  }

  function returnToEmailStep() {
    clearMessages();
    setStep('email');
    setCode('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswords(false);
    setResendSeconds(0);
  }

  async function handleSendCode() {
    if (!isLoaded || isLoading) return;
    if (!email.trim()) {
      setErrorMessage('Enter the email address already connected to your recipes.');
      return;
    }

    clearMessages();
    setIsLoading(true);
    try {
      await beginExistingAccountPasswordRecovery(signIn, email);
      enterSecureStep();
    } catch (error: unknown) {
      if (isUnknownRecoveryAccountError(error)) {
        // Keep account existence private. The next screen is intentionally identical.
        enterSecureStep();
      } else {
        setErrorMessage(clerkErrorMessage(
          error,
          'We could not send a verification code. Check your connection and try again.',
        ));
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRestoreAccess() {
    if (!isLoaded || isLoading) return;
    clearMessages();

    if (!/^\d{6}$/.test(code)) {
      setErrorMessage('Enter the six-digit verification code from your email.');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMessage('Create a password with at least eight characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('The passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await completeExistingAccountPasswordRecovery(
        signIn,
        code,
        newPassword,
      );
      if (result.status === 'complete') {
        await setActive({ session: result.sessionId });
        if (shouldNavigateAfterSessionActivation(CLERK_ENVIRONMENT)) router.replace('/(tabs)');
        return;
      }
      setErrorMessage(result.status === 'needs_second_factor'
        ? 'This account needs another verification step. Return to sign in with your original method or contact support.'
        : 'We could not finish restoring access. Request a new code and try again.');
    } catch (error: unknown) {
      setErrorMessage(completionErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleContactSupport() {
    try {
      await Linking.openURL(SUPPORT_URL);
    } catch {
      Alert.alert(
        'Could Not Open Email',
        'Email shimizutechnology@gmail.com and mention Håfa Recipes account recovery.',
      );
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
              if (step === 'secure') {
                returnToEmailStep();
              } else {
                clearMessages();
                leaveAuthScreen(router);
              }
            }}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel={step === 'secure' ? 'Back to email' : authBackAccessibilityLabel(router)}
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
            <Text style={[styles.backLabel, { color: colors.text }]}>Back</Text>
          </TouchableOpacity>

          <RNView style={styles.header}>
            <BrandMark size={80} style={{ backgroundColor: colors.backgroundSecondary }} />
            <Text style={[styles.eyebrow, { color: colors.tint }]}>Your recipes are safe</Text>
            <Text style={[styles.title, { color: colors.text }]}>Restore my library</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {step === 'email'
                ? 'Use the email from your existing Håfa account. We’ll verify it so you can create a password and return to your recipes.'
                : 'Enter the code from your email and create a password for reliable access from now on.'}
            </Text>
          </RNView>

          {statusMessage && (
            <RNView
              style={[styles.statusBanner, {
                backgroundColor: `${colors.success}15`,
                borderColor: colors.success,
              }]}
              accessibilityLiveRegion="polite"
            >
              <Ionicons name="mail-unread-outline" size={20} color={colors.success} />
              <Text style={[styles.bannerText, { color: colors.success }]}>{statusMessage}</Text>
            </RNView>
          )}

          {errorMessage && (
            <RNView
              style={[styles.statusBanner, {
                backgroundColor: `${colors.error}15`,
                borderColor: colors.error,
              }]}
              accessibilityRole="alert"
            >
              <Ionicons name="alert-circle-outline" size={20} color={colors.error} />
              <Text style={[styles.bannerText, { color: colors.error }]}>{errorMessage}</Text>
            </RNView>
          )}

          <RNView style={styles.form}>
            {step === 'email' ? (
              <>
                <RNView style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>Existing account email</Text>
                  <Input
                    value={email}
                    onChangeText={(value) => { setEmail(value); clearMessages(); }}
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                    onSubmitEditing={() => { if (email.trim()) void handleSendCode(); }}
                    returnKeyType="send"
                  />
                </RNView>
                <Button
                  title={isLoading ? 'Sending code…' : 'Continue securely'}
                  onPress={() => void handleSendCode()}
                  disabled={isLoading || !email.trim()}
                  loading={isLoading}
                  size="lg"
                />
              </>
            ) : (
              <>
                <RNView style={styles.emailSummary}>
                  <RNView style={styles.emailSummaryCopy}>
                    <Text style={[styles.emailSummaryLabel, { color: colors.textSecondary }]}>Recovering</Text>
                    <Text style={[styles.emailSummaryValue, { color: colors.text }]} numberOfLines={1}>
                      {email.trim()}
                    </Text>
                  </RNView>
                  <TouchableOpacity
                    style={styles.editEmailButton}
                    onPress={returnToEmailStep}
                    disabled={isLoading}
                    accessibilityRole="button"
                    accessibilityLabel="Change recovery email"
                  >
                    <Text style={[styles.editEmailText, { color: colors.tint }]}>Change</Text>
                  </TouchableOpacity>
                </RNView>

                <RNView style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>Verification code</Text>
                  <Input
                    value={code}
                    onChangeText={(value) => {
                      setCode(value.replace(/\D/g, '').slice(0, 6));
                      clearMessages();
                    }}
                    placeholder="6-digit code"
                    keyboardType="number-pad"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                    maxLength={6}
                    autoFocus
                  />
                </RNView>

                <RNView style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>New password</Text>
                  <RNView style={styles.passwordContainer}>
                    <Input
                      value={newPassword}
                      onChangeText={(value) => { setNewPassword(value); clearMessages(); }}
                      placeholder="At least 8 characters"
                      secureTextEntry={!showPasswords}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!isLoading}
                      style={styles.passwordInput}
                      showClearButton={false}
                    />
                    <TouchableOpacity
                      style={styles.passwordToggle}
                      onPress={() => setShowPasswords((visible) => !visible)}
                      disabled={isLoading}
                      accessibilityRole="button"
                      accessibilityLabel={showPasswords ? 'Hide passwords' : 'Show passwords'}
                    >
                      <Ionicons
                        name={showPasswords ? 'eye-off-outline' : 'eye-outline'}
                        size={20}
                        color={colors.textMuted}
                      />
                    </TouchableOpacity>
                  </RNView>
                </RNView>

                <RNView style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>Confirm password</Text>
                  <Input
                    value={confirmPassword}
                    onChangeText={(value) => { setConfirmPassword(value); clearMessages(); }}
                    placeholder="Enter it again"
                    secureTextEntry={!showPasswords}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                    showClearButton={false}
                    onSubmitEditing={() => { void handleRestoreAccess(); }}
                    returnKeyType="done"
                  />
                </RNView>

                <Button
                  title={isLoading ? 'Restoring access…' : 'Restore my recipes'}
                  onPress={() => void handleRestoreAccess()}
                  disabled={
                    isLoading || code.length !== 6 || newPassword.length < 8 ||
                    confirmPassword.length < 8
                  }
                  loading={isLoading}
                  size="lg"
                />
                <Button
                  title={resendSeconds > 0 ? `Send another code in ${resendSeconds}s` : 'Send another code'}
                  onPress={() => void handleSendCode()}
                  disabled={isLoading || resendSeconds > 0}
                  variant="ghost"
                />
              </>
            )}
          </RNView>

          <RNView style={[styles.note, {
            backgroundColor: colors.backgroundSecondary,
            borderColor: colors.border,
          }]}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} />
            <Text style={[styles.noteText, { color: colors.textSecondary }]}>
              This restores only an existing account. It never creates a second library or changes who owns your recipes.
            </Text>
          </RNView>

          <RNView style={[styles.appleNote, { borderColor: colors.border }]}>
            <Ionicons name="logo-apple" size={19} color={colors.text} />
            <RNView style={styles.appleNoteCopy}>
              <Text style={[styles.appleNoteTitle, { color: colors.text }]}>Used Hide My Email?</Text>
              <Text style={[styles.noteText, { color: colors.textSecondary }]}>
                In Apple Settings, open your Apple Account and Sign in with Apple to find the Håfa Recipes relay address. Enter that address above.
              </Text>
              <TouchableOpacity
                style={styles.supportButton}
                onPress={() => void handleContactSupport()}
                accessibilityRole="link"
                accessibilityLabel="Contact Håfa Recipes support for account recovery"
              >
                <Text style={[styles.supportText, { color: colors.tint }]}>I can’t access this email</Text>
                <Ionicons name="open-outline" size={16} color={colors.tint} />
              </TouchableOpacity>
            </RNView>
          </RNView>
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
    minHeight: 44,
    paddingHorizontal: spacing.sm,
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
    fontSize: fontSize.xxxl,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    lineHeight: 23,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  statusBanner: {
    alignItems: 'flex-start',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  bannerText: { flex: 1, fontFamily: fontFamily.medium, fontSize: fontSize.sm, lineHeight: 19 },
  form: { gap: spacing.lg, marginBottom: spacing.xl },
  inputGroup: { gap: spacing.xs },
  label: { fontFamily: fontFamily.medium, fontSize: fontSize.sm },
  emailSummary: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  emailSummaryCopy: { flex: 1 },
  emailSummaryLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.xs },
  emailSummaryValue: { fontFamily: fontFamily.semibold, fontSize: fontSize.sm },
  editEmailButton: { justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing.sm },
  editEmailText: { fontFamily: fontFamily.semibold, fontSize: fontSize.sm },
  passwordContainer: { position: 'relative' },
  passwordInput: { paddingRight: 52 },
  passwordToggle: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    position: 'absolute',
    right: spacing.xs,
    top: 0,
  },
  note: {
    alignItems: 'flex-start',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  noteText: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.sm, lineHeight: 20 },
  appleNote: {
    alignItems: 'flex-start',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  appleNoteCopy: { flex: 1, gap: spacing.xs },
  appleNoteTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.sm },
  supportButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 44,
  },
  supportText: { fontFamily: fontFamily.semibold, fontSize: fontSize.sm },
});
