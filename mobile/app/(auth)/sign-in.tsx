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
import { useSignIn, useSSO } from '@clerk/clerk-expo';
import { useRouter, Link } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Input, Button, useColors } from '@/components/Themed';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

// Required for OAuth to work properly
WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const { startSSOFlow } = useSSO();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Email/password sign in
  const handleEmailSignIn = async () => {
    if (!isLoaded) return;
    
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing Fields', 'Please enter your email and password.');
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
        router.replace('/(tabs)');
      } else {
        console.log('Sign in result:', result);
        Alert.alert('Error', 'Could not complete sign in. Please try again.');
      }
    } catch (error: any) {
      console.error('Sign in error:', error);
      Alert.alert(
        'Sign In Failed',
        error.errors?.[0]?.message || 'Invalid email or password. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // OAuth sign in (Apple/Google)
  const handleOAuthSignIn = useCallback(async (strategy: 'oauth_apple' | 'oauth_google') => {
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
        'Sign In Failed',
        error.errors?.[0]?.message || 'Could not sign in. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [isLoaded, startSSOFlow, router]);

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo / Header */}
          <RNView style={styles.header}>
            <RNView style={[styles.logoContainer, { backgroundColor: colors.tint + '15' }]}>
              <Text style={styles.logoEmoji}>🍳</Text>
            </RNView>
            <Text style={[styles.title, { color: colors.text }]}>Welcome Back</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Sign in to access your recipes
            </Text>
          </RNView>

          {/* OAuth Buttons */}
          <RNView style={styles.oauthContainer}>
            <TouchableOpacity
              style={[styles.oauthButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
              onPress={() => handleOAuthSignIn('oauth_apple')}
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
              onPress={() => handleOAuthSignIn('oauth_google')}
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

            <Button
              title={isLoading ? 'Signing in...' : 'Sign In'}
              onPress={handleEmailSignIn}
              disabled={isLoading || !email.trim() || !password.trim()}
              loading={isLoading}
              size="lg"
            />
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

