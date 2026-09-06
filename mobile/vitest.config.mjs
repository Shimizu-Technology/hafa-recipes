import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@/': fileURLToPath(new URL('./', import.meta.url)),
      'expo-image': fileURLToPath(new URL('./tests/expo-image-shim.tsx', import.meta.url)),
      'react-native': fileURLToPath(new URL('./tests/react-native-shim.tsx', import.meta.url)),
    },
  },
});
