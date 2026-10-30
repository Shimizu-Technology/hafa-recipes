import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const root = new URL('./node_modules/expo-share-intent/plugin/build/ios/', import.meta.url);
const controller = readFileSync(new URL('ShareExtensionViewController.swift', root), 'utf8');
describe('per-item native share visibility', () => {
  it('waits for explicit Save before enqueueing the captured item', () => {
    const redirect = controller.split('private func redirectToHostApp')[1].split('@objc private func submitCapture')[0];
    expect(redirect).not.toContain('enqueueLink');
    expect(redirect).toContain('\"confirmed\": false');
    expect(redirect).toContain('confirmationCaptureKey = source.key');
    expect(redirect).toContain('updateVisibilityChoices()');
    const submit = controller.split('@objc private func submitCapture')[1].split('private var confirmationTitle')[0];
    expect(submit.indexOf('metadata["requestedIsPublic"] = requested')).toBeLessThan(submit.indexOf('enqueueLink'));
    expect(submit).toContain('guard !captureSubmitted');
    expect(submit).toContain('metadata[\"confirmed\"] = true');
  });
  it('offers labelled, growing choices that update only the captured receipt', () => {
    expect(controller).toContain('["Private", "Share to Discover"]');
    expect(controller).toContain('heightAnchor.constraint(greaterThanOrEqualToConstant: 48)');
    expect(controller).toContain('choice.titleLabel?.numberOfLines = 0');
    const choice = controller.split('@objc private func changeCaptureVisibility')[1].split('private func showCaptureConfirmation')[0];
    expect(choice).toContain('defaults.set(metadata, forKey: "\\(key).meta")');
    expect(choice).not.toContain('preferencesKey');
    expect(choice).not.toContain('sessionKey');
  });
  it('bundles DM Sans into the extension and registers it for the Håfa controls', () => {
    expect(controller).toContain('UIFont(name: "DMSans-Regular"');
    expect(readFileSync(new URL('writeIosShareExtensionFiles.js', root), 'utf8')).toContain('UIAppFonts: ["DMSans.ttf"]');
    expect(readFileSync(new URL('withIosShareExtensionXcodeTarget.js', root), 'utf8')).toContain('"DMSans.ttf"');
  });
});

it('keeps lock contention off UIKit actions and bounds every lock attempt', () => {
  const store = readFileSync(new URL('./modules/hafa-share-bridge/ios/HafaShareShared.swift', import.meta.url), 'utf8');
  expect(store).toContain('LOCK_EX | LOCK_NB');
  expect(store).toContain('ProcessInfo.processInfo.systemUptime');
  expect(store).toContain('timeout: TimeInterval = 0.25');
  expect(store).toContain('qos: .utility');
  expect(store).toContain('DispatchQueue.main.async { completion(result) }');
  for (const name of ['submitCapture', 'changeCaptureVisibility']) {
    const action = controller.split(`@objc private func ${name}`)[1].split('\n  }')[0];
    expect(action).toContain('writeCapture(');
  }
  expect(controller).toContain('captureWriting = true');
  expect(controller).toContain('[weak self]');
  expect(controller).toContain('Could not save the choice. Try again. Your source and last saved choice are safe.');
  expect(controller).not.toContain('flock(descriptor, LOCK_EX)');
});
