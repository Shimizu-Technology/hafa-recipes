export type SourcePlaybackProvider = 'youtube' | 'tiktok' | 'instagram';
export type ModalSourcePlaybackProvider = Exclude<SourcePlaybackProvider, 'instagram'>;
export type SourceMediaKind = 'video' | 'photo' | 'post' | 'reel';

type ModalSourcePlaybackBase = {
  mode: 'modal';
  embedUrl: string;
  aspectRatio: number;
  requestHeaders?: Record<string, string>;
};

export type ModalSourcePlayback = ModalSourcePlaybackBase & (
  | { provider: 'youtube'; providerLabel: 'YouTube'; mediaKind: 'video' }
  | { provider: 'tiktok'; providerLabel: 'TikTok'; mediaKind: 'video' | 'photo' }
);

export type ExternalSourcePlayback = {
  mode: 'external';
  provider: 'instagram';
  providerLabel: 'Instagram';
  mediaKind: 'post' | 'reel' | 'video';
};

export type SourcePlayback = ModalSourcePlayback | ExternalSourcePlayback;

export const YOUTUBE_APP_REFERRER = 'https://com.shimizutechnology.recipeextractor';

/**
 * Request playback only after the cook has explicitly tapped the preview.
 * Photo posts keep their soundtrack user-controlled; videos autoplay only
 * after the cook explicitly taps the preview.
 */
export function getAutoplayEmbedUrl(playback: ModalSourcePlayback): string {
  const url = new URL(playback.embedUrl);
  if (playback.mediaKind === 'video') url.searchParams.set('autoplay', '1');
  return url.toString();
}

function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isExactPlayerDocument(playback: ModalSourcePlayback, destination: URL): boolean {
  const player = new URL(playback.embedUrl);
  return destination.protocol === 'https:'
    && destination.hostname.toLocaleLowerCase('en').replace(/\.$/, '')
      === player.hostname.toLocaleLowerCase('en').replace(/\.$/, '')
    && destination.pathname === player.pathname;
}

/** Keep the WebView on its exact player document, never a browsable provider page. */
export function isSourcePlaybackNavigationAllowed(
  playback: ModalSourcePlayback,
  destinationUrl: string,
): boolean {
  if (destinationUrl === 'about:blank') return true;

  try {
    const parsed = new URL(destinationUrl);
    if (isExactPlayerDocument(playback, parsed)) return true;

    if (
      playback.provider === 'youtube'
      && parsed.protocol === 'https:'
      && parsed.hostname.toLocaleLowerCase('en').replace(/\.$/, '') === 'consent.youtube.com'
      && parsed.pathname === '/m'
    ) {
      const continueUrl = parsed.searchParams.get('continue');
      return Boolean(continueUrl && isExactPlayerDocument(playback, new URL(continueUrl)));
    }

    return false;
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
      mode: 'modal',
      mediaKind: 'video',
      embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?playsinline=1&rel=0&origin=${origin}`,
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
      mode: 'modal',
      mediaKind: pathParts[kindIndex] === 'photo' ? 'photo' : 'video',
      embedUrl: `https://www.tiktok.com/player/v1/${postId}?autoplay=0&description=1&music_info=1&rel=0`,
      aspectRatio: 9 / 16,
    };
  }

  if (hostMatches(hostname, 'instagram.com')) {
    const kindIndex = pathParts.findIndex((part) => ['p', 'reel', 'reels', 'tv'].includes(part));
    const shortcode = kindIndex >= 0 ? pathParts[kindIndex + 1] : null;
    if (!validProviderId(shortcode, /^[A-Za-z0-9_-]{5,100}$/)) return null;
    return {
      provider: 'instagram',
      providerLabel: 'Instagram',
      mode: 'external',
      mediaKind: ['reel', 'reels'].includes(pathParts[kindIndex] || '')
        ? 'reel'
        : pathParts[kindIndex] === 'p'
          ? 'post'
          : 'video',
    };
  }

  return null;
}
