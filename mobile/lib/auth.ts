/**
 * Clerk authentication utilities for React Native.
 * 
 * Uses the official Clerk token cache from @clerk/clerk-expo/token-cache
 * which handles secure storage with expo-secure-store.
 */

// Re-export the official token cache from Clerk
export { tokenCache } from '@clerk/clerk-expo/token-cache';

/**
 * Clerk publishable key - loaded from environment.
 * 
 * To set this up:
 * 1. Go to clerk.com and create an application
 * 2. Get your publishable key from the API Keys section
 * 3. Add to .env file as EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
 */
export const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || '';

