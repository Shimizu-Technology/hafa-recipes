import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccountHeaderButton } from '@/components/TabChrome';
import { IconButton, useColors } from '@/components/Themed';
import { fontFamily } from '@/constants/Colors';
import { reportTabScreenBottomInset } from '@/lib/bottomOverlay';

/** A tab screen's safe area includes the native tab bar; share it with app-wide overlays. */
function TabBarInsetReporter() {
  const { bottom } = useSafeAreaInsets();
  const focused = useIsFocused();
  useEffect(() => { if (focused) reportTabScreenBottomInset(bottom); }, [focused, bottom]);
  return null;
}

export function RecipeTabStack({ title, library = false }: { title: string; library?: boolean }) {
  const colors = useColors();
  const router = useRouter();
  const transparentHeader = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;
  return <><TabBarInsetReporter /><Stack screenOptions={{
    headerLargeTitleEnabled: true,
    headerLargeTitleStyle: { fontFamily: fontFamily.displaySemibold, fontSize: 32, color: colors.text },
    headerTitleStyle: { fontFamily: fontFamily.displaySemibold, color: colors.text },
    // iOS 26 hides large titles behind custom navigation-bar backgrounds.
    headerTransparent: transparentHeader,
    headerStyle: transparentHeader ? undefined : { backgroundColor: colors.background },
    headerTintColor: colors.actionText,
    headerShadowVisible: false,
    headerRight: () => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {library && <IconButton icon="add" accessibilityLabel="Add a recipe" color={colors.actionText} onPress={() => router.push('/add-options')} />}
      <AccountHeaderButton />
    </View>,
  }}><Stack.Screen name="index" options={{ title }} /></Stack></>;
}
