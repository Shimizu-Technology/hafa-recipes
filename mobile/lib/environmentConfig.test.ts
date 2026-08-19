import { describe, expect, it } from 'vitest';

import {
  environmentLabel,
  PRODUCTION_API_BASE_URL,
  resolveApiBaseUrl,
  resolveAppEnvironment,
} from './environmentConfig';

describe('mobile environment configuration', () => {
  it('never falls back to production for a development build', () => {
    expect(() =>
      resolveApiBaseUrl({ appEnvironment: 'development' }),
    ).toThrow('Could not determine the local API host');
  });

  it('derives a local simulator target from a private development host', () => {
    expect(
      resolveApiBaseUrl({
        appEnvironment: 'development',
        developmentHost: '192.168.1.22',
      }),
    ).toBe('http://192.168.1.22:8000');

    expect(() =>
      resolveApiBaseUrl({
        appEnvironment: 'development',
        developmentHost: '10.evil.example',
      }),
    ).toThrow('not a local/private address');
  });

  it('requires an explicit exceptional override for a remote development API', () => {
    expect(() =>
      resolveApiBaseUrl({
        appEnvironment: 'development',
        configuredUrl: PRODUCTION_API_BASE_URL,
      }),
    ).toThrow('cannot use a remote API');

    expect(
      resolveApiBaseUrl({
        appEnvironment: 'development',
        configuredUrl: PRODUCTION_API_BASE_URL,
        allowRemoteDevelopmentApi: true,
      }),
    ).toBe(PRODUCTION_API_BASE_URL);

    expect(() =>
      resolveApiBaseUrl({
        appEnvironment: 'development',
        configuredUrl: 'http://development.example.com',
        allowRemoteDevelopmentApi: true,
      }),
    ).toThrow('must use HTTPS');
  });

  it('requires preview builds to declare their HTTPS backend', () => {
    expect(() => resolveApiBaseUrl({ appEnvironment: 'preview' })).toThrow(
      'Preview builds must explicitly set',
    );
    expect(() =>
      resolveApiBaseUrl({
        appEnvironment: 'preview',
        configuredUrl: 'http://preview.example.com',
      }),
    ).toThrow('must use HTTPS');
  });

  it('uses the production API only for production by default', () => {
    expect(resolveApiBaseUrl({ appEnvironment: 'production' })).toBe(
      PRODUCTION_API_BASE_URL,
    );
  });

  it('rejects secrets and ambiguous routing in configured API URLs', () => {
    for (const configuredUrl of [
      'https://user:password@api.example.com',
      'https://api.example.com?token=secret',
      'https://api.example.com#alternate',
    ]) {
      expect(() =>
        resolveApiBaseUrl({
          appEnvironment: 'preview',
          configuredUrl,
        }),
      ).toThrow(/must not include/);
    }
  });

  it('validates environment names and labels non-production builds', () => {
    expect(resolveAppEnvironment(undefined, true)).toBe('development');
    expect(() => resolveAppEnvironment(undefined, false)).toThrow(
      'Release builds must explicitly set',
    );
    expect(resolveAppEnvironment('preview', false)).toBe('preview');
    expect(() => resolveAppEnvironment('staging', false)).toThrow(
      'development, preview, or production',
    );
    expect(environmentLabel('development', 'http://localhost:8000')).toBe(
      'DEVELOPMENT • localhost:8000',
    );
    expect(environmentLabel('production', PRODUCTION_API_BASE_URL)).toBeNull();
  });
});
