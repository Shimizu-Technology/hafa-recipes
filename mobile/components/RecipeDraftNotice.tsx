import { View } from 'react-native';
import { Text, Button } from '@/components/Themed';
export function RecipeDraftNotice({ draft }: { draft: { hasContent?: boolean; available: unknown; error: string | null; resume: () => void; discard: () => Promise<void> } }) {
  if (!draft.available && !draft.error && !draft.hasContent) return null;
  return <View>
    {draft.hasContent && !draft.available && <Text>Private draft stays on this device. Cleared when you sign out.</Text>}
    {draft.error && <Text accessibilityRole="alert">Draft could not be saved: {draft.error}</Text>}
    {!!draft.available && <>
      <Text>Private draft on this device</Text>
      <Button title="Resume draft" onPress={draft.resume} />
      <Button title="Discard draft" variant="secondary" onPress={() => { void draft.discard(); }} />
    </>}
  </View>;
}
