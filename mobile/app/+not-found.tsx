import { Link, Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { useShareIntentContext } from 'expo-share-intent';

import { Text, View, useColors } from '@/components/Themed';

export default function NotFoundScreen() {
  const router = useRouter();
  const colors = useColors();
  const { hasShareIntent } = useShareIntentContext();

  // Unknown share URLs recover to Library; background intake owns the queue.
  useEffect(() => {
    if (hasShareIntent) {
      router.replace('/(tabs)/recipes');
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

        <Link href="/(tabs)/recipes" style={styles.link}>
          <Text style={[styles.linkText, { color: colors.actionText }]}>Go to home screen!</Text>
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
    fontSize: 15,
    fontWeight: '600',
  },
});
