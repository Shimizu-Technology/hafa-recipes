import Constants from 'expo-constants';
import { NativeModules } from 'react-native';

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

  const sourceCode = NativeModules.SourceCode as
    | { scriptURL?: string; getConstants?: () => { scriptURL?: string } }
    | undefined;
  const sourceCodeUrl = sourceCode?.scriptURL || sourceCode?.getConstants?.().scriptURL;
  const developmentHost =
    Constants.expoConfig?.hostUri ||
    Constants.manifest?.debuggerHost ||
    Constants.experienceUrl ||
    Constants.linkingUri ||
    Constants.intentUri ||
    sourceCodeUrl;

  if (developmentHost) {
    try {
      const hostUrl = developmentHost.includes('://')
        ? developmentHost
        : `http://${developmentHost}`;
      const host = new URL(hostUrl).hostname;
      if (host) return `http://${host}:8000`;
    } catch {
      // Fall through to the production API when Expo provides a malformed host.
    }
  }
  return PRODUCTION_API_BASE_URL;
}

export const API_BASE_URL = getApiBaseUrl();
