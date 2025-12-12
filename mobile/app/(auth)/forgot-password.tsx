import { useState } from 'react';
import {
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  View as RNView,
} from 'react-native';
import { useSignIn } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Input, Button, useColors } from '@/components/Themed';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

export default function ForgotPasswordScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const clearError = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // Step 1: Request password reset code
  const handleRequestCode = async () => {
    if (!isLoaded) return;
    setErrorMessage(null);
    
    if (!email.trim()) {
      setErrorMessage('Please enter your email address.');
      return;
    }

    setIsLoading(true);
    try {
      await signIn.create({
        strategy: 'reset_password_email_code',
        identifier: email.trim(),
      });
      
      setSuccessMessage('Check your email for a verification code.');
      setStep('code');
    } catch (error: any) {
      console.error('Password reset error:', error);
      const clerkError = error.errors?.[0];
      if (clerkError?.code === 'form_identifier_not_found') {
        setErrorMessage('No account found with this email address.');
      } else {
        setErrorMessage(clerkError?.longMessage || clerkError?.message || 'Could not send reset code. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Reset password with code
  const handleResetPassword = async () => {
    if (!isLoaded) return;
    setErrorMessage(null);

    if (!code.trim()) {
      setErrorMessage('Please enter the verification code.');
      return;
    }

    if (newPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code: code.trim(),
        password: newPassword,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.replace('/(tabs)');
      } else {
        console.log('Reset result:', result);
        setErrorMessage('Could not reset password. Please try again.');
      }
    } catch (error: any) {
      console.error('Password reset error:', error);
      const clerkError = error.errors?.[0];
      if (clerkError?.code === 'form_code_incorrect') {
        setErrorMessage('Invalid verification code. Please check and try again.');
      } else if (clerkError?.code === 'form_password_pwned') {
        setErrorMessage('This password has been compromised in a data breach. Please choose a different password.');
      } else {
        setErrorMessage(clerkError?.longMessage || clerkError?.message || 'Could not reset password. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl }
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back Button */}
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: colors.backgroundSecondary }]}
            onPress={() => step === 'code' ? setStep('email') : router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
            <Text style={[styles.backButtonText, { color: colors.text }]}>Back</Text>
          </TouchableOpacity>

          {/* Header */}
          <RNView style={styles.header}>
            <RNView style={[styles.logoContainer, { backgroundColor: colors.tint + '15' }]}>
              <Ionicons name="key-outline" size={40} color={colors.tint} />
            </RNView>
            <Text style={[styles.title, { color: colors.text }]}>
              {step === 'email' ? 'Reset Password' : 'Enter New Password'}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {step === 'email' 
                ? "Enter your email and we'll send you a reset code"
                : `We sent a code to ${email}`
              }
            </Text>
          </RNView>

          {/* Success Banner */}
          {successMessage && (
            <RNView style={[styles.successBanner, { backgroundColor: colors.success + '15', borderColor: colors.success }]}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={[styles.successText, { color: colors.success }]}>{successMessage}</Text>
            </RNView>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <RNView style={[styles.errorBanner, { backgroundColor: colors.error + '15', borderColor: colors.error }]}>
              <Ionicons name="alert-circle" size={20} color={colors.error} />
              <Text style={[styles.errorText, { color: colors.error }]}>{errorMessage}</Text>
            </RNView>
          )}

          {step === 'email' ? (
            /* Step 1: Email Form */
            <RNView style={styles.form}>
              <RNView style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
                <Input
                  value={email}
                  onChangeText={(text) => { setEmail(text); clearError(); }}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                />
              </RNView>

              <Button
                title={isLoading ? 'Sending...' : 'Send Reset Code'}
                onPress={handleRequestCode}
                disabled={isLoading || !email.trim()}
                loading={isLoading}
                size="lg"
              />
            </RNView>
          ) : (
            /* Step 2: Code + New Password Form */
            <RNView style={styles.form}>
              <RNView style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Verification Code</Text>
                <Input
                  value={code}
                  onChangeText={(text) => { setCode(text); clearError(); }}
                  placeholder="Enter 6-digit code"
                  keyboardType="number-pad"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                  maxLength={6}
                />
              </RNView>

              <RNView style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>New Password</Text>
                <RNView style={styles.passwordContainer}>
                  <Input
                    value={newPassword}
                    onChangeText={(text) => { setNewPassword(text); clearError(); }}
                    placeholder="••••••••"
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                    style={styles.passwordInput}
                  />
                  <TouchableOpacity
                    style={styles.passwordToggle}
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                </RNView>
              </RNView>

              <RNView style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Confirm New Password</Text>
                <Input
                  value={confirmPassword}
                  onChangeText={(text) => { setConfirmPassword(text); clearError(); }}
                  placeholder="••••••••"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                />
              </RNView>

              <Button
                title={isLoading ? 'Resetting...' : 'Reset Password'}
                onPress={handleResetPassword}
                disabled={isLoading || !code.trim() || !newPassword.trim() || !confirmPassword.trim()}
                loading={isLoading}
                size="lg"
              />

              {/* Resend Code */}
              <TouchableOpacity
                style={styles.resendButton}
                onPress={() => {
                  setCode('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setSuccessMessage(null);
                  handleRequestCode();
                }}
                disabled={isLoading}
              >
                <Text style={[styles.resendText, { color: colors.tint }]}>
                  Didn't receive the code? Send again
                </Text>
              </TouchableOpacity>
            </RNView>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingLeft: spacing.xs,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  backButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    marginLeft: 2,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  successText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  errorText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  form: {
    gap: spacing.lg,
  },
  inputGroup: {
    gap: spacing.xs,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  passwordContainer: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 48,
  },
  passwordToggle: {
    position: 'absolute',
    right: spacing.md,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  resendButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  resendText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
});

