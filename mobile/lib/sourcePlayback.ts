export type SourcePlaybackProvider = 'youtube' | 'tiktok' | 'instagram';

export type SourcePlayback = {
  provider: SourcePlaybackProvider;
  providerLabel: string;
  embedUrl: string;
  aspectRatio: number;
  requestHeaders?: Record<string, string>;
};

export const YOUTUBE_APP_REFERRER = 'https://com.shimizutechnology.recipeextractor';

function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

const PROVIDER_DOMAINS: Record<SourcePlaybackProvider, string> = {
  youtube: 'youtube.com',
  tiktok: 'tiktok.com',
  instagram: 'instagram.com',
};

/** Keep player-initiated navigation inside the selected provider. */
export function isSourcePlaybackNavigationAllowed(
  provider: SourcePlaybackProvider,
  destinationUrl: string,
): boolean {
  if (destinationUrl === 'about:blank') return true;

  try {
    const parsed = new URL(destinationUrl);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLocaleLowerCase('en').replace(/\.$/, '');
    return hostMatches(hostname, PROVIDER_DOMAINS[provider]);
  } catch {
    return false;
  }
}

function validProviderId(value: string | null, pattern: RegExp): value is string {
  return Boolean(value && pattern.test(value));
}

/** Build only official provider embeds from trusted recipe source hosts. */
export function getSourcePlayback(sourceUrl: string): SourcePlayback | null {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return null;

  const hostname = parsed.hostname.toLocaleLowerCase('en').replace(/\.$/, '');
  const pathParts = parsed.pathname.split('/').filter(Boolean);

  if (hostname === 'youtu.be' || hostMatches(hostname, 'youtube.com')) {
    let videoId: string | null = null;
    if (hostname === 'youtu.be') {
      videoId = pathParts[0] || null;
    } else if (parsed.pathname === '/watch') {
      videoId = parsed.searchParams.get('v');
    } else if (['shorts', 'embed', 'live'].includes(pathParts[0] || '')) {
      videoId = pathParts[1] || null;
    }

    if (!validProviderId(videoId, /^[A-Za-z0-9_-]{6,20}$/)) return null;
    const origin = encodeURIComponent(YOUTUBE_APP_REFERRER);
    return {
      provider: 'youtube',
      providerLabel: 'YouTube',
      embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?playsinline=1&rel=0&origin=${origin}`,
      aspectRatio: 16 / 9,
      requestHeaders: { Referer: YOUTUBE_APP_REFERRER },
    };
  }

  if (hostMatches(hostname, 'tiktok.com')) {
    const kindIndex = pathParts.findIndex((part) => part === 'video' || part === 'photo');
    const postId = kindIndex >= 0 ? pathParts[kindIndex + 1] : null;
    if (!validProviderId(postId, /^\d{6,30}$/)) return null;

    return {
      provider: 'tiktok',
      providerLabel: 'TikTok',
      embedUrl: `https://www.tiktok.com/player/v1/${postId}?autoplay=0&description=1&music_info=1&rel=0`,
      aspectRatio: 9 / 16,
    };
  }

  if (hostMatches(hostname, 'instagram.com')) {
    const kindIndex = pathParts.findIndex((part) => ['p', 'reel', 'reels', 'tv'].includes(part));
    const shortcode = kindIndex >= 0 ? pathParts[kindIndex + 1] : null;
    if (!validProviderId(shortcode, /^[A-Za-z0-9_-]{5,100}$/)) return null;
    const kind = pathParts[kindIndex] === 'reels' ? 'reel' : pathParts[kindIndex];

    return {
      provider: 'instagram',
      providerLabel: 'Instagram',
      embedUrl: `https://www.instagram.com/${kind}/${encodeURIComponent(shortcode)}/embed/`,
      aspectRatio: 4 / 5,
    };
  }

  return null;
}
