import { Link, Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { useShareIntentContext } from 'expo-share-intent';

import { Text, View } from '@/components/Themed';

export default function NotFoundScreen() {
  const router = useRouter();
  const { hasShareIntent } = useShareIntentContext();

  // If we landed here due to a share intent, redirect to home immediately
  // The share intent handler will pick up the URL there
  useEffect(() => {
    if (hasShareIntent) {
      console.log('📥 Share intent detected on not-found, redirecting to home...');
      router.replace('/');
    }
  }, [hasShareIntent, router]);

  // If share intent is pending, show minimal loading state instead of error
  if (hasShareIntent) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Opening...</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={styles.container}>
        <Text style={styles.title}>This screen doesn't exist.</Text>

        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Go to home screen!</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
    color: '#2e78b7',
  },
});
