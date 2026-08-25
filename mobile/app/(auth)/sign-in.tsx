import { useState, useCallback } from 'react';
import {
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Image,
  View as RNView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSignIn } from '@clerk/expo/legacy';
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
import { clerkErrorMessage, isCancelledAppleSignIn, shouldNavigateAfterSessionActivation } from '@/lib/accountAccess';
import { CLERK_ENVIRONMENT } from '@/lib/clerkMigration';
import { signInWithAppleToken, signInWithBrowserProvider } from '@/lib/socialAuthentication';

// Required for OAuth to work properly (for Apple Sign-In)
WebBrowser.maybeCompleteAuthSession();

// NOTE: Native Google Sign-In disabled for now due to crashes
// Using web-based OAuth flow instead for better stability
// TODO: Re-enable native Google Sign-In once the root cause is identified

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Clear error when user starts typing
  const clearError = () => setErrorMessage(null);

  // Email/password sign in
  const handleEmailSignIn = async () => {
    if (!isLoaded) return;
    setErrorMessage(null);

    if (!email.trim() || !password.trim()) {
      setErrorMessage('Please enter your email and password.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await signIn.create({
        identifier: email.trim(),
        password: password,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        if (shouldNavigateAfterSessionActivation(CLERK_ENVIRONMENT)) router.replace('/(tabs)');
      } else if (result.status === 'needs_second_factor') {
        // 2FA is enabled on this account - not currently supported in app
        console.log('Sign in requires 2FA:', result);
        setErrorMessage('This account has two-factor authentication enabled. Please disable 2FA in your account settings or use Apple/Google sign-in.');
      } else {
        console.log('Sign in result:', result);
        setErrorMessage('Could not complete sign in. Please try again.');
      }
    } catch (error: any) {
      // Extract user-friendly error message from Clerk (don't console.error - it's noisy)
      const clerkError = error.errors?.[0];
      if (clerkError) {
        switch (clerkError.code) {
          case 'form_identifier_not_found':
            setErrorMessage('No account found with this email. Check your email or sign up.');
            break;
          case 'form_password_incorrect':
            setErrorMessage('Incorrect password. Please try again or reset your password.');
            break;
          case 'strategy_for_user_invalid':
            setErrorMessage('This account uses a different sign-in method (Apple/Google). Try those instead.');
            break;
          default:
            setErrorMessage(clerkError.longMessage || clerkError.message || 'Invalid email or password.');
        }
      } else {
        setErrorMessage('Could not sign in. Please check your connection and try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // iOS uses Apple's native credential. Neither path is allowed to create an account.
  const handleAppleSignIn = useCallback(async () => {
    if (!isLoaded) return;
    setErrorMessage(null);

    setIsLoading(true);
    try {
      const result = Platform.OS === 'ios'
        ? await (async () => {
          const credential = await AppleAuthentication.signInAsync({
            requestedScopes: [
              AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
              AppleAuthentication.AppleAuthenticationScope.EMAIL,
            ],
            nonce: Crypto.randomUUID(),
          });
          return signInWithAppleToken(signIn, credential.identityToken ?? '');
        })()
        : await signInWithBrowserProvider(signIn, 'oauth_apple', Linking.createURL('oauth-callback'));

      if (result.status === 'complete') {
        await setActive({ session: result.sessionId });
        if (shouldNavigateAfterSessionActivation(CLERK_ENVIRONMENT)) router.replace('/(tabs)');
      } else if (result.status === 'account_not_found') {
        setErrorMessage('This Apple account is not connected yet. Choose “Find my existing recipes” below to restore your original library.');
      } else if (result.status === 'incomplete') {
        setErrorMessage('Could not finish signing in with Apple. Please try again.');
      }
    } catch (error: unknown) {
      if (!isCancelledAppleSignIn(error)) {
        setErrorMessage(clerkErrorMessage(error, 'Could not sign in with Apple. Please try again.'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [isLoaded, signIn, setActive, router]);

  // Google Sign-In - uses web-based SSO flow on all platforms
  // NOTE: Native Google Sign-In was causing crashes, using web flow for stability
  const handleGoogleSignIn = useCallback(async () => {
    if (!isLoaded) return;
    setErrorMessage(null);

    setIsLoading(true);
    try {
      const result = await signInWithBrowserProvider(
        signIn,
        'oauth_google',
        Linking.createURL('oauth-callback'),
      );

      if (result.status === 'complete') {
        await setActive({ session: result.sessionId });
        if (shouldNavigateAfterSessionActivation(CLERK_ENVIRONMENT)) router.replace('/(tabs)');
      } else if (result.status === 'account_not_found') {
        setErrorMessage('This Google account is not connected yet. Choose “Find my existing recipes” below to restore your original library.');
      } else if (result.status === 'incomplete') {
        setErrorMessage('Could not finish signing in with Google. Please try again.');
      }
    } catch (error: unknown) {
      setErrorMessage(clerkErrorMessage(error, 'Could not sign in with Google. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  }, [isLoaded, signIn, setActive, router]);

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
            <Text style={[styles.title, { color: colors.text }]}>Welcome back</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Sign in to save, plan, shop, and cook from your recipe library.
            </Text>
          </RNView>

          {/* OAuth Buttons */}
          <RNView style={styles.oauthContainer}>
            <TouchableOpacity
              style={[styles.oauthButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
              onPress={handleAppleSignIn}
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
              onPress={handleGoogleSignIn}
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
              <RNView style={styles.labelRow}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Password</Text>
                <Link href={'/(auth)/forgot-password' as any} asChild>
                  <TouchableOpacity disabled={isLoading}>
                    <Text style={[styles.forgotLink, { color: colors.tint }]}>Forgot password?</Text>
                  </TouchableOpacity>
                </Link>
              </RNView>
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

            <Button
              title={isLoading ? 'Signing in...' : 'Sign In'}
              onPress={handleEmailSignIn}
              disabled={isLoading || !email.trim() || !password.trim()}
              loading={isLoading}
              size="lg"
            />

            <Link href={'/(auth)/recover-account' as any} asChild>
              <TouchableOpacity
                style={[styles.recoveryButton, {
                  backgroundColor: colors.backgroundSecondary,
                  borderColor: colors.border,
                }]}
                disabled={isLoading}
                activeOpacity={0.7}
              >
                <Ionicons name="library-outline" size={19} color={colors.tint} />
                <RNView style={styles.recoveryCopy}>
                  <Text style={[styles.recoveryTitle, { color: colors.text }]}>
                    Find my existing recipes
                  </Text>
                  <Text style={[styles.recoverySubtitle, { color: colors.textSecondary }]}>
                    Verify your account with an email code
                  </Text>
                </RNView>
                <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
              </TouchableOpacity>
            </Link>
          </RNView>

          {/* Sign Up Link */}
          <RNView style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.textSecondary }]}>
              Don't have an account?{' '}
            </Text>
            <Link href={'/(auth)/sign-up' as any} asChild>
              <TouchableOpacity disabled={isLoading}>
                <Text style={[styles.footerLink, { color: colors.tint }]}>Sign Up</Text>
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
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  forgotLink: {
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
  recoveryButton: {
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  recoveryCopy: { flex: 1, gap: 2 },
  recoveryTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.sm },
  recoverySubtitle: { fontFamily: fontFamily.regular, fontSize: fontSize.xs },
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
