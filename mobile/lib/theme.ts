import type { ColorSchemeName } from 'react-native';

export function normalizeColorScheme(colorScheme: ColorSchemeName): 'light' | 'dark' {
  return colorScheme === 'dark' ? 'dark' : 'light';
}
