import { Stack } from 'expo-router';
import { AccountHeaderButton } from '@/components/TabChrome';
import { headerRightOptions } from '@/components/chrome/HeaderButton';
import { useColors } from '@/components/Themed';
import { fontFamily } from '@/constants/Colors';

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
    headerTransparent: false,
    headerStyle: { backgroundColor: colors.background },
    headerLargeStyle: { backgroundColor: colors.background },
    headerTintColor: colors.actionText,
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    ...headerRightOptions(() => <AccountHeaderButton />),
  }}><Stack.Screen name="index" options={{ title }} /></Stack>;
}
