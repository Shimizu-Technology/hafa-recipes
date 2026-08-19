import Constants from 'expo-constants';
import { NativeModules } from 'react-native';

import {
  environmentLabel,
  PRODUCTION_API_BASE_URL,
  resolveApiBaseUrl,
  resolveAppEnvironment,
} from '@/lib/environmentConfig';

export { PRODUCTION_API_BASE_URL };

export function getApiBaseUrl(): string {
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

  let inferredHost: string | undefined;
  if (developmentHost) {
    try {
      const hostUrl = developmentHost.includes('://')
        ? developmentHost
        : `http://${developmentHost}`;
      inferredHost = new URL(hostUrl).hostname;
    } catch {
      // The resolver below will produce a clear setup error.
    }
  }

  return resolveApiBaseUrl({
    appEnvironment: APP_ENVIRONMENT,
    configuredUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
    developmentHost: inferredHost,
    allowRemoteDevelopmentApi:
      process.env.EXPO_PUBLIC_ALLOW_REMOTE_DEVELOPMENT_API === 'true',
  });
}

export const APP_ENVIRONMENT = resolveAppEnvironment(
  process.env.EXPO_PUBLIC_APP_ENV,
  __DEV__,
);
export const API_BASE_URL = getApiBaseUrl();
export const ENVIRONMENT_LABEL = environmentLabel(APP_ENVIRONMENT, API_BASE_URL);
