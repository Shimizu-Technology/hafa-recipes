import { Redirect, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useRecipeOwnerGeneration } from '@/hooks/useOfflineLease';
import { HistoryScreen } from '@/app/history';

export default function RecipesScreen() {
  const generation = useRecipeOwnerGeneration();
  const focused = useIsFocused();
  const { scope } = useLocalSearchParams<{ scope?: string }>();
  if (scope === 'discover') return <Redirect href="/(tabs)/discover" />;
  return <HistoryScreen key={generation} active={focused} />;
}
