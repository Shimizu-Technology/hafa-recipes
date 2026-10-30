import { describe, expect, it } from 'vitest';
import { redirectSystemPath } from './nativeLaunchRoute';
describe('native launch destination', () => {
  it.each(['/', '', 'hafarecipes:///', 'exp://127.0.0.1:8081/--/'])('starts home-screen launches at Recipes: %s', path => {
    expect(redirectSystemPath({ path, initial: true })).toBe('/(tabs)/recipes');
  });
  it.each(['/(tabs)/index', '/(tabs)/discover', '/(tabs)/history', 'hafarecipes://index', 'hafarecipes://dataUrl=capture#text', '/?captureToken=abc', '/recipe/recipe-a'])('preserves explicit old and capture links: %s', path => {
    expect(redirectSystemPath({ path, initial: true })).toBe(path);
    expect(redirectSystemPath({ path, initial: false })).toBe(path);
  });
});
