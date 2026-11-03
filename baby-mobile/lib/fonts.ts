/**
 * The six faces Håfa Baby uses, imported one weight at a time so the bundle carries only these files.
 * Family names match `fonts` in components/ui.tsx; app/_layout.tsx loads them behind the splash.
 */
import { DMSans_400Regular } from "@expo-google-fonts/dm-sans/400Regular";
import { DMSans_500Medium } from "@expo-google-fonts/dm-sans/500Medium";
import { DMSans_600SemiBold } from "@expo-google-fonts/dm-sans/600SemiBold";
import { DMSans_700Bold } from "@expo-google-fonts/dm-sans/700Bold";
import { Newsreader_500Medium } from "@expo-google-fonts/newsreader/500Medium";
import { Newsreader_500Medium_Italic } from "@expo-google-fonts/newsreader/500Medium_Italic";

export const fontFiles = {
  DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold, Newsreader_500Medium, Newsreader_500Medium_Italic,
};
