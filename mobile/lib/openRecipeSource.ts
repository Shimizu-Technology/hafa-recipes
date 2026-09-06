import { Alert, Linking } from 'react-native';

/** Open a recipe's creator-owned source without leaving a rejected promise behind. */
export async function openRecipeSource(sourceUrl: string): Promise<boolean> {
  try {
    await Linking.openURL(sourceUrl);
    return true;
  } catch {
    Alert.alert(
      'Couldn’t open original',
      'Please try again. The original source is still attached to this recipe.',
    );
    return false;
  }
}
