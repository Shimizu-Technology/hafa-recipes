import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/components/Themed';

interface SignInRequiredViewProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
}

export function SignInRequiredView({ icon, title, message }: SignInRequiredViewProps) {
  const colors = useColors();
  const router = useRouter();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.iconContainer, { backgroundColor: colors.card }]}>
        <Ionicons name={icon} size={48} color={colors.tint} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.message, { color: colors.textMuted }]}>{message}</Text>
      <TouchableOpacity 
        style={[styles.signInButton, { backgroundColor: colors.tint }]}
        onPress={() => router.push('/(auth)/sign-in')}
        activeOpacity={0.8}
      >
        <Ionicons name="log-in-outline" size={20} color="#fff" />
        <Text style={styles.signInButtonText}>Sign In</Text>
      </TouchableOpacity>
      <TouchableOpacity 
        onPress={() => router.push('/(auth)/sign-up')}
        activeOpacity={0.7}
      >
        <Text style={[styles.createAccountText, { color: colors.tint }]}>
          Don't have an account? <Text style={styles.createAccountBold}>Create one</Text>
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    overflow: 'hidden',
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  signInButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  signInButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  createAccountText: {
    fontSize: 15,
  },
  createAccountBold: {
    fontWeight: '600',
  },
});
