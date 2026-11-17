import { useRouter } from 'expo-router';
import { HeaderIconButton } from '@/components/chrome/HeaderButton';

/** Import can replace the tab stack during share intake, leaving no Back history. */
export function ImportCloseButton() {
  const router = useRouter();
  return <HeaderIconButton icon="close" accessibilityLabel="Close Import and open Library"
    onPress={() => router.dismissTo('/(tabs)/recipes')} />;
}
