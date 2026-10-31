import { Stack, useRouter } from 'expo-router';
import { useColors } from '@/components/Themed';
import { Platform } from 'react-native';
import { AccountHeaderButton } from '@/components/TabChrome';
import menuIcon from '@/assets/icons/browse-menu.xml';
import addIcon from '@/assets/icons/browse-add.xml';

type Action = { title: string; onPress: () => void };
export function RecipeBrowseHeader({ library = false, actions }: { library?: boolean; actions: Action[] }) {
  const router = useRouter();
  const colors = useColors();
  return <Stack.Toolbar placement="right">
    <Stack.Toolbar.Menu icon={Platform.OS === 'ios' ? 'ellipsis' : menuIcon} tintColor={colors.actionText} accessibilityLabel={library ? 'Library options' : 'Discover options'}>
      <Stack.Toolbar.Label>Options</Stack.Toolbar.Label>
      {actions.map(action => <Stack.Toolbar.MenuAction key={action.title} onPress={action.onPress}>{action.title}</Stack.Toolbar.MenuAction>)}
    </Stack.Toolbar.Menu>
    {library && <Stack.Toolbar.Button icon={Platform.OS === 'ios' ? 'plus' : addIcon} tintColor={colors.actionText} accessibilityLabel="Add a recipe" onPress={() => router.push('/add-options')}>Add</Stack.Toolbar.Button>}
    <Stack.Toolbar.View><AccountHeaderButton /></Stack.Toolbar.View>
  </Stack.Toolbar>;
}
