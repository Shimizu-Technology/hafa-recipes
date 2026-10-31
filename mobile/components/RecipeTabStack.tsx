import { Stack, useRouter } from 'expo-router';
import { View } from 'react-native';
import { AccountHeaderButton } from '@/components/TabChrome';
import { IconButton, useColors } from '@/components/Themed';
import { fontFamily } from '@/constants/Colors';

export function RecipeTabStack({ title, library = false }: { title: string; library?: boolean }) {
  const colors = useColors();
  const router = useRouter();
  return <Stack screenOptions={{
    headerLargeTitleEnabled: true,
    headerLargeTitleStyle: { fontFamily: fontFamily.displaySemibold, fontSize: 32, color: colors.text },
    headerTitleStyle: { fontFamily: fontFamily.displaySemibold, color: colors.text },
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.actionText,
    headerShadowVisible: false,
    headerRight: () => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {library && <IconButton icon="add" accessibilityLabel="Add a recipe" color={colors.actionText} onPress={() => router.push('/add-options')} />}
      <AccountHeaderButton />
    </View>,
  }}><Stack.Screen name="index" options={{ title }} /></Stack>;
}
