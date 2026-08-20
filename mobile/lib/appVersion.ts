import appConfig from '../app.json';

export function resolveAppVersion(runtimeVersion?: string | null): string {
  return runtimeVersion ?? appConfig.expo.version;
}
