import { useState, useCallback } from 'react';
import {
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  View as RNView,
  Alert,
} from 'react-native';
import { useSSO, useClerk } from '@clerk/expo';
import { useSignUp } from '@clerk/expo/legacy';
import { useRouter, Link } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Input, Button, useColors } from '@/components/Themed';
import { BrandMark } from '@/components/BrandMark';
import { spacing, fontSize, fontWeight, radius, fontFamily } from '@/constants/Colors';
import { clerkErrorMessage, isCancelledAppleSignIn } from '@/lib/accountAccess';
import { beginAccountOnboarding, clearAccountOnboarding, failAccountOnboarding } from '@/lib/accountOnboarding';
import { CLERK_ENVIRONMENT, getOrCreateInstallationId, onboardProductionAccount } from '@/lib/clerkMigration';

// Required for OAuth to work properly (for Apple Sign-In)
WebBrowser.maybeCompleteAuthSession();

// NOTE: Native Google Sign-In disabled for now due to crashes
// Using web-based OAuth flow instead for better stability
// TODO: Re-enable native Google Sign-In once the root cause is identified

export default function SignUpScreen() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const { startSSOFlow } = useSSO();
  const clerk = useClerk();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Clear error when user starts typing
  const clearError = () => setErrorMessage(null);

  const completeExplicitSignUp = useCallback(async (
    sessionId: string,
    userId: string,
    activate?: (params: { session: string }) => Promise<void>,
  ) => {
    const needsOnboarding = CLERK_ENVIRONMENT === 'production';
    const activateSession = activate ?? setActive;
    if (!activateSession) throw new Error('The new account session is unavailable');

    // Establish the intent and exact owner before activating: AuthProtection may
    // immediately redirect the new session and otherwise mount private queries.
    if (needsOnboarding) await beginAccountOnboarding(sessionId, userId);

    try {
      await activateSession({ session: sessionId });

      if (needsOnboarding) {
        const activeSession = clerk.session;
        if (!activeSession || activeSession.id !== sessionId || activeSession.user.id !== userId) {
          throw new Error('The new account could not be securely verified');
        }
        const token = await activeSession.getToken({
          template: 'recipe-extractor-public-metadata',
        });
        if (!token) throw new Error('The new account session is unavailable');

        const installationId = await getOrCreateInstallationId();
        await onboardProductionAccount(token, installationId);
        await clearAccountOnboarding(sessionId);
      }

      // The production access gate temporarily unmounts navigation; once it
      // verifies this owner, AuthProtection redirects from the auth screen.
      if (!needsOnboarding) router.replace('/(tabs)');
    } catch (error) {
      if (needsOnboarding) failAccountOnboarding(sessionId, error);
      throw error;
    }
  }, [clerk, router, setActive]);

  // Email/password sign up
  const handleEmailSignUp = async () => {
    if (!isLoaded) return;
    setErrorMessage(null);

    if (!email.trim() || !password.trim()) {
      setErrorMessage('Please enter your email and password.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters.');
      return;
    }

    setIsLoading(true);
    try {
      // Create signup with optional first name
      await signUp.create({
        emailAddress: email.trim(),
        password: password,
        firstName: firstName.trim() || undefined,
      });

      // Send email verification code
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
    } catch (error: any) {
      // Extract user-friendly error message from Clerk
      const clerkError = error.errors?.[0];
      if (clerkError) {
        // Common Clerk error codes and their friendly messages
        switch (clerkError.code) {
          case 'form_identifier_exists':
            setErrorMessage('This email is already registered. Try signing in instead.');
            break;
          case 'form_password_pwned':
            setErrorMessage('This password has been compromised in a data breach. Please choose a different password.');
            break;
          case 'form_password_length_too_short':
            setErrorMessage('Password must be at least 8 characters.');
            break;
          default:
            setErrorMessage(clerkError.longMessage || clerkError.message || 'Could not create account. Please try again.');
        }
      } else {
        setErrorMessage('Could not create account. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Verify email code
  const handleVerifyEmail = async () => {
    if (!isLoaded) return;
    setErrorMessage(null);

    setIsLoading(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: verificationCode,
      });

      if (result.status === 'complete' && result.createdSessionId && result.createdUserId) {
        await completeExplicitSignUp(result.createdSessionId, result.createdUserId);
      } else {
        console.log('Verification result:', result);
        setErrorMessage('Could not complete verification. Please try again.');
      }
    } catch (error: any) {
      const clerkError = error.errors?.[0];
      setErrorMessage(clerkError?.longMessage || clerkError?.message || 'Invalid code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Account creation is explicit here; native iOS preserves Apple's relay identity.
  const handleAppleSignUp = useCallback(async () => {
    if (!isLoaded) return;
    setErrorMessage(null);

    setIsLoading(true);
    try {
      if (Platform.OS === 'ios') {
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
          nonce: Crypto.randomUUID(),
        });
        if (!credential.identityToken) throw new Error('Apple did not provide a sign-up credential');

        const result = await signUp.create({
          strategy: 'oauth_token_apple',
          token: credential.identityToken,
          firstName: credential.fullName?.givenName ?? undefined,
          lastName: credential.fullName?.familyName ?? undefined,
        });
        if (result.status === 'complete' && result.createdSessionId && result.createdUserId) {
          await completeExplicitSignUp(result.createdSessionId, result.createdUserId);
        } else if (result.verifications.externalAccount.status === 'transferable') {
          setErrorMessage('This Apple account already has a recipe library. Please sign in instead.');
        } else {
          setErrorMessage('Could not finish creating your Apple account. Please try again.');
        }
      } else {
        const result = await startSSOFlow({
          strategy: 'oauth_apple',
          redirectUrl: Linking.createURL('oauth-callback'),
        });
        if (
          result.createdSessionId && result.signUp?.createdSessionId === result.createdSessionId &&
          result.signUp.createdUserId && result.setActive
        ) {
          await completeExplicitSignUp(result.createdSessionId, result.signUp.createdUserId, result.setActive);
        } else if (result.createdSessionId) {
          setErrorMessage('This Apple account already has a recipe library. Please sign in instead.');
        }
      }
    } catch (error: unknown) {
      if (!isCancelledAppleSignIn(error)) {
        setErrorMessage(clerkErrorMessage(error, 'Could not sign up with Apple. Please try again.'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [isLoaded, signUp, startSSOFlow, completeExplicitSignUp]);

  // Google Sign-Up - uses web-based SSO flow on all platforms
  // NOTE: Native Google Sign-In was causing crashes, using web flow for stability
  const handleGoogleSignUp = useCallback(async () => {
    if (!isLoaded) return;
    setErrorMessage(null);

    setIsLoading(true);
    try {
      const result = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: Linking.createURL('oauth-callback'),
      });

      if (
        result.createdSessionId && result.signUp?.createdSessionId === result.createdSessionId &&
        result.signUp.createdUserId && result.setActive
      ) {
        await completeExplicitSignUp(result.createdSessionId, result.signUp.createdUserId, result.setActive);
      } else if (result.createdSessionId) {
        setErrorMessage('This Google account already has a recipe library. Please sign in instead.');
      }
    } catch (error: unknown) {
      setErrorMessage(clerkErrorMessage(error, 'Could not sign up with Google. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  }, [isLoaded, startSSOFlow, completeExplicitSignUp]);

  // Verification screen
  if (pendingVerification) {
    return (
      <View style={styles.container}>
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
            onPress={() => setPendingVerification(false)}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
            <Text style={[styles.backButtonText, { color: colors.text }]}>Back</Text>
          </TouchableOpacity>

          <RNView style={styles.header}>
            <RNView style={[styles.logoContainer, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name="mail-outline" size={38} color={colors.accent} />
            </RNView>
            <Text style={[styles.eyebrow, { color: colors.tint }]}>Almost there</Text>
            <Text style={[styles.title, { color: colors.text }]}>Check your email</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              We sent a verification code to {email}
            </Text>
          </RNView>

          {/* Error Banner */}
          {errorMessage && (
            <RNView style={[styles.errorBanner, { backgroundColor: colors.error + '15', borderColor: colors.error }]}>
              <Ionicons name="alert-circle" size={20} color={colors.error} />
              <Text style={[styles.errorText, { color: colors.error }]}>{errorMessage}</Text>
            </RNView>
          )}

          <RNView style={styles.form}>
            <RNView style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Verification Code</Text>
              <Input
                value={verificationCode}
                onChangeText={(text) => { setVerificationCode(text); clearError(); }}
                placeholder="Enter 6-digit code"
                keyboardType="number-pad"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
                maxLength={6}
              />
            </RNView>

            <Button
              title={isLoading ? 'Verifying...' : 'Verify Email'}
              onPress={handleVerifyEmail}
              disabled={isLoading || verificationCode.length < 6}
              loading={isLoading}
              size="lg"
            />
          </RNView>
        </ScrollView>
      </View>
    );
  }

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
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
            <Text style={[styles.backButtonText, { color: colors.text }]}>Back</Text>
          </TouchableOpacity>

          {/* Logo / Header */}
          <RNView style={styles.header}>
            <BrandMark size={86} style={{ backgroundColor: colors.backgroundSecondary }} />
            <Text style={[styles.eyebrow, { color: colors.tint }]}>Håfa Recipes</Text>
            <Text style={[styles.title, { color: colors.text }]}>Create account</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Build a smarter recipe library from videos, websites, photos, and family favorites.
            </Text>
          </RNView>

          {/* OAuth Buttons */}
          <RNView style={styles.oauthContainer}>
            <TouchableOpacity
              style={[styles.oauthButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
              onPress={handleAppleSignUp}
              disabled={isLoading}
              activeOpacity={0.7}
            >
              <Ionicons name="logo-apple" size={20} color={colors.text} />
              <Text style={[styles.oauthButtonText, { color: colors.text }]}>
                Continue with Apple
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.oauthButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
              onPress={handleGoogleSignUp}
              disabled={isLoading}
              activeOpacity={0.7}
            >
              <Ionicons name="logo-google" size={20} color={colors.text} />
              <Text style={[styles.oauthButtonText, { color: colors.text }]}>
                Continue with Google
              </Text>
            </TouchableOpacity>
          </RNView>

          {/* Divider */}
          <RNView style={styles.dividerContainer}>
            <RNView style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.textMuted }]}>or</Text>
            <RNView style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </RNView>

          {/* Error Banner */}
          {errorMessage && (
            <RNView style={[styles.errorBanner, { backgroundColor: colors.error + '15', borderColor: colors.error }]}>
              <Ionicons name="alert-circle" size={20} color={colors.error} />
              <Text style={[styles.errorText, { color: colors.error }]}>{errorMessage}</Text>
            </RNView>
          )}

          {/* Email Form */}
          <RNView style={styles.form}>
            <RNView style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>First Name (optional)</Text>
              <Input
                value={firstName}
                onChangeText={(text) => { setFirstName(text); clearError(); }}
                placeholder="Your name"
                autoCapitalize="words"
                autoCorrect={false}
                editable={!isLoading}
              />
            </RNView>

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

            <RNView style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Password</Text>
              <RNView style={styles.passwordContainer}>
                <Input
                  value={password}
                  onChangeText={(text) => { setPassword(text); clearError(); }}
                  placeholder="••••••••"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                  style={styles.passwordInput}
                  showClearButton={false}
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
              <Text style={[styles.label, { color: colors.textSecondary }]}>Confirm Password</Text>
              <Input
                value={confirmPassword}
                onChangeText={(text) => { setConfirmPassword(text); clearError(); }}
                placeholder="••••••••"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
                showClearButton={false}
              />
            </RNView>

            <Button
              title={isLoading ? 'Creating Account...' : 'Create Account'}
              onPress={handleEmailSignUp}
              disabled={isLoading || !email.trim() || !password.trim() || !confirmPassword.trim()}
              loading={isLoading}
              size="lg"
            />
          </RNView>

          {/* Sign In Link */}
          <RNView style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.textSecondary }]}>
              Already have an account?{' '}
            </Text>
            <Link href={'/(auth)/sign-in' as any} asChild>
              <TouchableOpacity disabled={isLoading}>
                <Text style={[styles.footerLink, { color: colors.tint }]}>Sign In</Text>
              </TouchableOpacity>
            </Link>
          </RNView>
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
    borderRadius: radius.xl,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  eyebrow: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: fontSize.xxxl,
    fontFamily: fontFamily.display,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  oauthContainer: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  oauthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  oauthButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
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
    marginBottom: spacing.xl,
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
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: {
    fontSize: fontSize.md,
  },
  footerLink: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
