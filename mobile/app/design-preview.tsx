import { useEffect, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

import { lookFromLink, useLookPreview } from '@/contexts/LookContext';

/** `hafarecipes://design-preview?look=<id>` picks a look in development/preview builds; production just opens the app. */
export default function DesignPreviewLink() {
  const { look } = useLocalSearchParams<{ look?: string | string[] }>();
  const { enabled, setLook } = useLookPreview();
  const [done, setDone] = useState(false);
  useEffect(() => {
    const next = lookFromLink(look, enabled);
    if (!next) { setDone(true); return; }
    void setLook(next).finally(() => setDone(true));
  }, [enabled, look, setLook]);
  return done ? <Redirect href="/(tabs)/recipes" /> : null;
}
