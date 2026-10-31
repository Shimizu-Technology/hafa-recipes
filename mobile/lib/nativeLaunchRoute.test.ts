import { describe, expect, it } from 'vitest';
import { redirectSystemPath } from './nativeLaunchRoute';
describe('native launch destination', () => {
  it.each(['/', '', 'hafarecipes:///', 'exp://127.0.0.1:8081/--/'])('starts home-screen launches at Library: %s', path => {
    expect(redirectSystemPath({ path, initial: true })).toBe('/(tabs)/recipes');
  });
  it.each([
    ['/(tabs)/index', '/'], ['/(tabs)/history', '/history'],
    ['/(tabs)/index?captureToken=abc#receipt', '/?captureToken=abc#receipt'],
    ['hafarecipes://index?inboxCaptureId=receipt', '/?inboxCaptureId=receipt'],
    ['hafarecipes://history', '/history'], ['/index?sharedUrl=https%3A%2F%2Fexample.com', '/?sharedUrl=https%3A%2F%2Fexample.com'],
    ['exp://127.0.0.1:8083/--/(tabs)/history', '/history'],
    ['hafarecipes:///(tabs)/index?sharedReceiptId=receipt', '/?sharedReceiptId=receipt'],
    ['hafarecipes://(tabs)/index?captureToken=abc#receipt', '/?captureToken=abc#receipt'],
    ['hafarecipes://(tabs)/history?scope=library', '/history?scope=library'],
  ])('preserves the destination and parameters of %s', (path, expected) => {
    expect(redirectSystemPath({ path, initial: true })).toBe(expected);
    expect(redirectSystemPath({ path, initial: false })).toBe(expected);
  });
  it.each(['/(tabs)/discover', 'hafarecipes://dataUrl=capture#text', '/?captureToken=abc', '/?sharedUrl=https%3A%2F%2Fexample.com', '/recipe/recipe-a', 'hafarecipes://discover?query=rice'])('preserves explicit content and capture links: %s', path => {
    expect(redirectSystemPath({ path, initial: true })).toBe(path);
    expect(redirectSystemPath({ path, initial: false })).toBe(path);
  });
  it('keeps the warm root capture route', () => expect(redirectSystemPath({ path: '/', initial: false })).toBe('/'));
});

// Both cold launch and warm delivery use the same legacy route translation.
describe.each([true, false])('legacy trailing slashes (initial=%s)', initial => {
  it.each(['index', 'history'])('preserves query and hash for %s across relative, app and Expo URLs', route => {
    const suffix = '?scope=library&captureToken=a%2Fb#receipt';
    const destination = route === 'index' ? '/' : '/history';
    const paths = [
      `/(tabs)/${route}/`, `hafarecipes://(tabs)/${route}/`,
      `hafarecipes:///(tabs)/${route}/`, `hafarecipes://${route}/`,
      `exp://127.0.0.1:8083/--/(tabs)/${route}/`,
      `exps://example.test/--/(tabs)/${route}/`,
      `exp+hafarecipes://127.0.0.1:8083/--/(tabs)/${route}/`,
    ];
    if (route === 'index') paths.push('/index/');
    for (const path of paths) {
      expect(redirectSystemPath({ path, initial })).toBe(destination);
      expect(redirectSystemPath({ path: path + suffix, initial })).toBe(destination + suffix);
    }
  });
});
