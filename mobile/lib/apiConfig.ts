import Constants from 'expo-constants';

export const PRODUCTION_API_BASE_URL = 'https://recipe-api-x5na.onrender.com';

function configuredApiBaseUrl(): string | null {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (!configured) return null;

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must be an absolute URL');
  }
  if (parsed.protocol !== 'https:' && !(__DEV__ && parsed.protocol === 'http:')) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must use HTTPS outside development');
  }
  return configured.replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  const configured = configuredApiBaseUrl();
  if (configured) return configured;
  if (!__DEV__) return PRODUCTION_API_BASE_URL;

  const debuggerHost = Constants.expoConfig?.hostUri || Constants.manifest?.debuggerHost;
  if (debuggerHost) {
    const host = debuggerHost.split(':')[0];
    return `http://${host}:8000`;
  }
  return PRODUCTION_API_BASE_URL;
}

export const API_BASE_URL = getApiBaseUrl();
