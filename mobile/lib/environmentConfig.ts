export type AppEnvironment = 'development' | 'preview' | 'production';

export const PRODUCTION_API_BASE_URL = 'https://recipe-api-x5na.onrender.com';

function isPrivateIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const octets = hostname.split('.').map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  return (
    octets[0] === 127 ||
    octets[0] === 10 ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
  );
}

export function resolveAppEnvironment(
  configured: string | undefined,
  isDevelopmentBuild: boolean,
): AppEnvironment {
  const normalized = configured?.trim().toLowerCase();
  if (!normalized) {
    if (isDevelopmentBuild) return 'development';
    throw new Error('Release builds must explicitly set EXPO_PUBLIC_APP_ENV');
  }
  if (normalized === 'development' || normalized === 'preview' || normalized === 'production') {
    return normalized;
  }
  throw new Error('EXPO_PUBLIC_APP_ENV must be development, preview, or production');
}

export function isLocalDevelopmentHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    isPrivateIpv4(normalized)
  );
}

function normalizedConfiguredUrl(configuredUrl: string | undefined): URL | null {
  const configured = configuredUrl?.trim();
  if (!configured) return null;

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must be an absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must use HTTP or HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must not include credentials');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must not include a query or fragment');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed;
}

export interface ApiEnvironmentOptions {
  appEnvironment: AppEnvironment;
  configuredUrl?: string;
  developmentHost?: string;
  allowRemoteDevelopmentApi?: boolean;
}

export function resolveApiBaseUrl({
  appEnvironment,
  configuredUrl,
  developmentHost,
  allowRemoteDevelopmentApi = false,
}: ApiEnvironmentOptions): string {
  const configured = normalizedConfiguredUrl(configuredUrl);

  if (appEnvironment === 'production') {
    if (!configured) return PRODUCTION_API_BASE_URL;
    if (configured.protocol !== 'https:') {
      throw new Error('Production API URLs must use HTTPS');
    }
    return configured.toString().replace(/\/$/, '');
  }

  if (appEnvironment === 'preview') {
    if (!configured) {
      throw new Error('Preview builds must explicitly set EXPO_PUBLIC_API_BASE_URL');
    }
    if (configured.protocol !== 'https:') {
      throw new Error('Preview API URLs must use HTTPS');
    }
    return configured.toString().replace(/\/$/, '');
  }

  if (configured) {
    if (!isLocalDevelopmentHost(configured.hostname)) {
      if (!allowRemoteDevelopmentApi) {
        throw new Error(
          'Development builds cannot use a remote API unless EXPO_PUBLIC_ALLOW_REMOTE_DEVELOPMENT_API=true',
        );
      }
      if (configured.protocol !== 'https:') {
        throw new Error('Remote development API URLs must use HTTPS');
      }
    }
    return configured.toString().replace(/\/$/, '');
  }

  if (!developmentHost) {
    throw new Error(
      'Could not determine the local API host; set EXPO_PUBLIC_API_BASE_URL to your local API',
    );
  }
  const host = developmentHost.replace(/^\[|\]$/g, '');
  if (!isLocalDevelopmentHost(host)) {
    throw new Error('The inferred development API host is not a local/private address');
  }
  return `http://${host.includes(':') ? `[${host}]` : host}:8000`;
}

export function environmentLabel(
  appEnvironment: AppEnvironment,
  apiBaseUrl: string,
): string | null {
  if (appEnvironment === 'production') return null;
  const host = new URL(apiBaseUrl).host;
  return `${appEnvironment.toUpperCase()} • ${host}`;
}
