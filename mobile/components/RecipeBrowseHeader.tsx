import { Stack, useRouter } from 'expo-router';
import { Alert, Platform, View } from 'react-native';
import { AccountHeaderButton } from '@/components/TabChrome';
import { IconButton, useColors } from '@/components/Themed';

type Action = { title: string; onPress: () => void };
export function RecipeBrowseHeader({ library = false, actions }: { library?: boolean; actions: Action[] }) {
  const colors = useColors();
  const router = useRouter();
  if (Platform.OS !== 'web') return <Stack.Toolbar placement="right">
    <Stack.Toolbar.Menu icon={Platform.OS === 'ios' ? 'ellipsis' : undefined} accessibilityLabel={library ? 'Library options' : 'Discover options'}>
      <Stack.Toolbar.Label>Options</Stack.Toolbar.Label>
      {actions.map(action => <Stack.Toolbar.MenuAction key={action.title} onPress={action.onPress}>{action.title}</Stack.Toolbar.MenuAction>)}
    </Stack.Toolbar.Menu>
    {library && <Stack.Toolbar.Button icon={Platform.OS === 'ios' ? 'plus' : undefined} accessibilityLabel="Add a recipe" onPress={() => router.push('/add-options')}>Add</Stack.Toolbar.Button>}
    <Stack.Toolbar.View><AccountHeaderButton /></Stack.Toolbar.View>
  </Stack.Toolbar>;
  return <Stack.Screen options={{ headerRight: () => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
    <IconButton icon="ellipsis-horizontal" accessibilityLabel={library ? 'Library options' : 'Discover options'} color={colors.actionText} onPress={() => Alert.alert(library ? 'Library' : 'Discover', undefined, [...actions.map(action => ({ text: action.title, onPress: action.onPress })), { text: 'Cancel', style: 'cancel' }])} />
    {library && <IconButton icon="add" accessibilityLabel="Add a recipe" color={colors.actionText} onPress={() => router.push('/add-options')} />}
    <AccountHeaderButton />
  </View> }} />;
}
