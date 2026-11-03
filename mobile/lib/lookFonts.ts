/** Font files for the design-preview looks, required per weight so each family name maps to one face. */
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_600SemiBold } from '@expo-google-fonts/dm-sans/600SemiBold';
import { DMSans_700Bold } from '@expo-google-fonts/dm-sans/700Bold';
import { Fraunces_500Medium } from '@expo-google-fonts/fraunces/500Medium';
import { Fraunces_700Bold } from '@expo-google-fonts/fraunces/700Bold';
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { Figtree_400Regular } from '@expo-google-fonts/figtree/400Regular';
import { Figtree_500Medium } from '@expo-google-fonts/figtree/500Medium';
import { Figtree_600SemiBold } from '@expo-google-fonts/figtree/600SemiBold';
import { Figtree_700Bold } from '@expo-google-fonts/figtree/700Bold';
import * as Font from 'expo-font';

import { LOOK_FONT_NAMES, type LookId } from '@/constants/looks';

const FILES: Record<string, number> = {
  DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold,
  Fraunces_500Medium, Fraunces_700Bold,
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold, Figtree_700Bold,
};

/** Load a look's faces; resolves once every weight is registered. */
export async function loadLookFonts(id: LookId): Promise<void> {
  const names = LOOK_FONT_NAMES[id];
  if (!names.length) return;
  await Font.loadAsync(Object.fromEntries(names.map(name => [name, FILES[name]])));
}
