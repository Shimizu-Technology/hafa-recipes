import { Stack, useRouter } from 'expo-router';
import { Platform } from 'react-native';
import { AccountHeaderButton } from '@/components/TabChrome';

type Action = { title: string; onPress: () => void };
export function RecipeBrowseHeader({ library = false, actions }: { library?: boolean; actions: Action[] }) {
  const router = useRouter();
  return <Stack.Toolbar placement="right">
    <Stack.Toolbar.Menu icon={Platform.OS === 'ios' ? 'ellipsis' : undefined} accessibilityLabel={library ? 'Library options' : 'Discover options'}>
      <Stack.Toolbar.Label>Options</Stack.Toolbar.Label>
      {actions.map(action => <Stack.Toolbar.MenuAction key={action.title} onPress={action.onPress}>{action.title}</Stack.Toolbar.MenuAction>)}
    </Stack.Toolbar.Menu>
    {library && <Stack.Toolbar.Button icon={Platform.OS === 'ios' ? 'plus' : undefined} accessibilityLabel="Add a recipe" onPress={() => router.push('/add-options')}>Add</Stack.Toolbar.Button>}
    <Stack.Toolbar.View><AccountHeaderButton /></Stack.Toolbar.View>
  </Stack.Toolbar>;
}
