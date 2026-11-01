import { Stack } from 'expo-router';
import { Platform } from 'react-native';
import { AccountHeaderButton } from '@/components/TabChrome';
import { headerRightOptions } from '@/components/chrome/HeaderButton';
import { useColors } from '@/components/Themed';
import { fontFamily } from '@/constants/Colors';

/** iOS 26 draws no large title over a coloured large-title background. */
export const liquidGlassHeader = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;

/**
 * A tab's stack with an opaque header on every OS: iOS 26 no longer gets a transparent
 * bar that lets the grid slide under the title, and iOS 18 matches it.
 */
export function RecipeTabStack({ title }: { title: string }) {
  const colors = useColors();
  return <Stack screenOptions={{
    headerLargeTitleEnabled: true,
    headerLargeTitleStyle: { fontFamily: fontFamily.displaySemibold, fontSize: 32, color: colors.text },
    headerTitleStyle: { fontFamily: fontFamily.displaySemibold, color: colors.text },
    // A solid colour, not glass or blur. Leave headerTransparent unset: false makes the iOS bar
    // non-translucent, which hides the large title beside a header search bar (Grocery).
    headerStyle: { backgroundColor: colors.background },
    // The page behind is the same colour, so iOS 26 still shows nothing through the title.
    headerLargeStyle: { backgroundColor: liquidGlassHeader ? 'transparent' : colors.background },
    headerTintColor: colors.actionText,
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    ...headerRightOptions(() => <AccountHeaderButton />),
  }}><Stack.Screen name="index" options={{ title }} /></Stack>;
}
