import { Stack } from 'expo-router';
import { AccountHeaderButton } from '@/components/TabChrome';
import { HeaderMenuButton, headerRightOptions, type HeaderMenuAction } from '@/components/chrome/HeaderButton';

/** Library and Discover headers: a ··· menu with the screen's extra actions, then the account. */
export function RecipeBrowseHeader({ library = false, actions }: { library?: boolean; actions: HeaderMenuAction[] }) {
  return <Stack.Screen options={headerRightOptions(() => <>
    {actions.length > 0 && <HeaderMenuButton accessibilityLabel={library ? 'Library options' : 'Discover options'} actions={actions} />}
    <AccountHeaderButton />
  </>)} />;
}
