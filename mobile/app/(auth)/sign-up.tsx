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
import { useSignUp, useSSO } from '@clerk/clerk-expo';
import { useRouter, Link } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Input, Button, useColors } from '@/components/Themed';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

// Required for OAuth to work properly
WebBrowser.maybeCompleteAuthSession();

export default function SignUpScreen() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const { startSSOFlow } = useSSO();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');

  // Email/password sign up
  const handleEmailSignUp = async () => {
    if (!isLoaded) return;
    
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing Fields', 'Please enter your email and password.');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Password Mismatch', 'Passwords do not match.');
      return;
    }

    if (password.length < 8) {
      Alert.alert('Weak Password', 'Password must be at least 8 characters.');
      return;
    }

    setIsLoading(true);
    try {
      await signUp.create({
        emailAddress: email.trim(),
        password: password,
      });

      // Send email verification code
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
    } catch (error: any) {
      console.error('Sign up error:', error);
      Alert.alert(
        'Sign Up Failed',
        error.errors?.[0]?.message || 'Could not create account. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Verify email code
  const handleVerifyEmail = async () => {
    if (!isLoaded) return;

    setIsLoading(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: verificationCode,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.replace('/(tabs)');
      } else {
        console.log('Verification result:', result);
        Alert.alert('Error', 'Could not complete verification.');
      }
    } catch (error: any) {
      console.error('Verification error:', error);
      Alert.alert(
        'Verification Failed',
        error.errors?.[0]?.message || 'Invalid code. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // OAuth sign up (Apple/Google)
  const handleOAuthSignUp = useCallback(async (strategy: 'oauth_apple' | 'oauth_google') => {
    if (!isLoaded) return;
    
    setIsLoading(true);
    try {
      const { createdSessionId, setActive: ssoSetActive } = await startSSOFlow({
        strategy,
        redirectUrl: 'recipeextractor://oauth-callback',
      });

      if (createdSessionId) {
        await ssoSetActive!({ session: createdSessionId });
        router.replace('/(tabs)');
      }
    } catch (error: any) {
      console.error('OAuth error:', error);
      Alert.alert(
        'Sign Up Failed',
        error.errors?.[0]?.message || 'Could not sign up. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [isLoaded, startSSOFlow, router]);

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
            <RNView style={[styles.logoContainer, { backgroundColor: colors.tint + '15' }]}>
              <Ionicons name="mail-outline" size={40} color={colors.tint} />
            </RNView>
            <Text style={[styles.title, { color: colors.text }]}>Check Your Email</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              We sent a verification code to {email}
            </Text>
          </RNView>

          <RNView style={styles.form}>
            <RNView style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Verification Code</Text>
              <Input
                value={verificationCode}
                onChangeText={setVerificationCode}
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
            <RNView style={[styles.logoContainer, { backgroundColor: colors.tint + '15' }]}>
              <Text style={styles.logoEmoji}>🍳</Text>
            </RNView>
            <Text style={[styles.title, { color: colors.text }]}>Create Account</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Start extracting recipes from videos
            </Text>
          </RNView>

          {/* OAuth Buttons */}
          <RNView style={styles.oauthContainer}>
            <TouchableOpacity
              style={[styles.oauthButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
              onPress={() => handleOAuthSignUp('oauth_apple')}
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
              onPress={() => handleOAuthSignUp('oauth_google')}
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

          {/* Email Form */}
          <RNView style={styles.form}>
            <RNView style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
              <Input
                value={email}
                onChangeText={setEmail}
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
                  onChangeText={setPassword}
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
              <Text style={[styles.label, { color: colors.textSecondary }]}>Confirm Password</Text>
              <Input
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="••••••••"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
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
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logoEmoji: {
    fontSize: 40,
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
    borderRadius: radius.md,
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

