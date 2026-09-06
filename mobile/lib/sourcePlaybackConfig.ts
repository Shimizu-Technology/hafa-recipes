export type SourcePlaybackMode = 'embedded' | 'external';

/** Resolve the release-controlled source playback policy without silently accepting typos. */
export function resolveSourcePlaybackMode(configured: string | undefined): SourcePlaybackMode {
  const normalized = configured?.trim().toLowerCase();
  if (!normalized) return 'embedded';
  if (normalized === 'embedded' || normalized === 'external') return normalized;
  console.warn(
    'Invalid EXPO_PUBLIC_SOURCE_PLAYBACK_MODE; embedded source playback is disabled.',
  );
  return 'external';
}

/** Resolve the playback policy from the build or update environment. */
export function getSourcePlaybackMode(): SourcePlaybackMode {
  return resolveSourcePlaybackMode(process.env.EXPO_PUBLIC_SOURCE_PLAYBACK_MODE);
}
