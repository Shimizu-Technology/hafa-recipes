import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';

import { useColors } from '@/components/Themed';
import { lookFromLink, useLookPreview } from '@/contexts/LookContext';

/** `hafarecipes://design-preview?look=<id>` picks a look in development/preview builds; production just opens the app. */
export default function DesignPreviewLink() {
  const { look } = useLocalSearchParams<{ look?: string | string[] }>();
  const { enabled, setLook } = useLookPreview();
  const colors = useColors();
  const [done, setDone] = useState(false);
  useEffect(() => {
    const next = lookFromLink(look, enabled);
    if (!next) { setDone(true); return; }
    void setLook(next).finally(() => setDone(true));
  }, [enabled, look, setLook]);
  if (done) return <Redirect href="/(tabs)/recipes" />;
  // The look's fonts may take a moment to register; keep the page ground on screen meanwhile.
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
    <ActivityIndicator color={colors.textSecondary} accessibilityLabel="Applying design preview" />
  </View>;
}
