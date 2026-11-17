import { useRouter } from 'expo-router';
import { HeaderIconButton } from '@/components/chrome/HeaderButton';

/** Safety net for restored or unknown Import states with no Back history. */
export function ImportCloseButton() {
  const router = useRouter();
  return <HeaderIconButton icon="close" accessibilityLabel="Close Import and open Library"
    onPress={() => router.dismissTo('/(tabs)/recipes')} />;
}
