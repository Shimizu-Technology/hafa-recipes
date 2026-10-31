import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/components/Themed';
import { Platform, type ImageSourcePropType } from 'react-native';
import { AccountHeaderButton } from '@/components/TabChrome';

type Action = { title: string; onPress: () => void };
export function RecipeBrowseHeader({ library = false, actions }: { library?: boolean; actions: Action[] }) {
  const router = useRouter();
  const colors = useColors();
  const [androidIcons, setAndroidIcons] = useState<{ menu: ImageSourcePropType; add: ImageSourcePropType }>();
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let active = true;
    void Promise.all([
      Ionicons.getImageSource('ellipsis-horizontal', 24, colors.actionText),
      Ionicons.getImageSource('add', 24, colors.actionText),
    ]).then(([menu, add]) => {
      if (active && menu && add) setAndroidIcons({ menu, add });
    }).catch(error => console.warn('Could not load Recipes toolbar icons', error));
    return () => { active = false; };
  }, [colors.actionText]);
  return <Stack.Toolbar placement="right">
    <Stack.Toolbar.Menu icon={Platform.OS === 'ios' ? 'ellipsis' : androidIcons?.menu} accessibilityLabel={library ? 'Library options' : 'Discover options'}>
      <Stack.Toolbar.Label>Options</Stack.Toolbar.Label>
      {actions.map(action => <Stack.Toolbar.MenuAction key={action.title} onPress={action.onPress}>{action.title}</Stack.Toolbar.MenuAction>)}
    </Stack.Toolbar.Menu>
    {library && <Stack.Toolbar.Button icon={Platform.OS === 'ios' ? 'plus' : androidIcons?.add} accessibilityLabel="Add a recipe" onPress={() => router.push('/add-options')}>Add</Stack.Toolbar.Button>}
    <Stack.Toolbar.View><AccountHeaderButton /></Stack.Toolbar.View>
  </Stack.Toolbar>;
}
