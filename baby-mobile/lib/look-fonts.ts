/**
 * Font files per look, imported one weight at a time so a look bundles only the faces it names. Loaded by the
 * LookProvider only when that look is chosen in a non-production build; production never loads them.
 */
import { DMSans_400Regular } from "@expo-google-fonts/dm-sans/400Regular";
import { DMSans_500Medium } from "@expo-google-fonts/dm-sans/500Medium";
import { DMSans_600SemiBold } from "@expo-google-fonts/dm-sans/600SemiBold";
import { DMSans_700Bold } from "@expo-google-fonts/dm-sans/700Bold";
import { Newsreader_500Medium } from "@expo-google-fonts/newsreader/500Medium";
import { Newsreader_500Medium_Italic } from "@expo-google-fonts/newsreader/500Medium_Italic";
import { YoungSerif_400Regular } from "@expo-google-fonts/young-serif/400Regular";
import { Caveat_600SemiBold } from "@expo-google-fonts/caveat/600SemiBold";
import { Fraunces_600SemiBold } from "@expo-google-fonts/fraunces/600SemiBold";
import { PlusJakartaSans_400Regular } from "@expo-google-fonts/plus-jakarta-sans/400Regular";
import { PlusJakartaSans_500Medium } from "@expo-google-fonts/plus-jakarta-sans/500Medium";
import { PlusJakartaSans_600SemiBold } from "@expo-google-fonts/plus-jakarta-sans/600SemiBold";
import { PlusJakartaSans_700Bold } from "@expo-google-fonts/plus-jakarta-sans/700Bold";
import type { LookId } from "./looks";

const dmSans = { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold };
export const lookFonts: Record<LookId, Record<string, number>> = {
  current: {},
  soft: { ...dmSans, Newsreader_500Medium, Newsreader_500Medium_Italic },
  scrapbook: { ...dmSans, YoungSerif_400Regular, Caveat_600SemiBold },
  warm: { Fraunces_600SemiBold, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold },
};
