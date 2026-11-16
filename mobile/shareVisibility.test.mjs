import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const root = new URL('./node_modules/expo-share-intent/plugin/build/ios/', import.meta.url);
const controller = readFileSync(new URL('ShareExtensionViewController.swift', root), 'utf8');
const card = (name) => readFileSync(new URL(`./share-extension/${name}`, import.meta.url), 'utf8');
const section = (start, end) => controller.split(start)[1].split(end)[0];
describe('per-item native share visibility', () => {
  it('waits for explicit Save before enqueueing the captured item', () => {
    const redirect = section('private func redirectToHostApp', 'private func submitCapture');
    expect(redirect).not.toContain('enqueueLink');
    expect(redirect).toContain('\"confirmed\": false');
    expect(redirect).toContain('confirmationCaptureKey = source.key');
    expect(redirect).toContain('refreshCard()');
    const submit = section('private func submitCapture', 'private func enqueueCapture');
    expect(submit.indexOf('metadata["requestedIsPublic"] = requested')).toBeLessThan(submit.indexOf('enqueueCapture('));
    expect(submit).toContain('guard !captureSubmitted');
    expect(submit).toContain('metadata[\"confirmed\"] = true');
    // Public, signed-out, photo and text captures stay on the phone for Håfa to finish.
    expect(submit).toContain('RecipeShareWords.sendsNow(');
  });
  it('offers two labelled cards that update only the captured receipt, private by default', () => {
    const words = card('RecipeShareWords.swift');
    expect(words).toContain('title: "Private", detail: "Only you"');
    expect(words).toContain('title: "Public", detail: "Anyone in Discover"');
    expect(words).toContain('Håfa will ask you to confirm before it goes public.');
    const choice = section('private func changeCaptureVisibility', 'private func submitCapture');
    expect(choice).toContain('defaults.set(metadata, forKey: "\\(key).meta")');
    expect(choice).not.toContain('preferencesKey');
    expect(choice).not.toContain('sessionKey');
    expect(controller).toContain('metadata["requestedIsPublic"] as? Bool ?? false');
  });
  it('takes a cancelled share back out of the queue but keeps a saved one', () => {
    const cancel = section('private func cancelCapture', 'private func closeCapture');
    expect(cancel).toContain('guard !captureSubmitted');
    expect(cancel).toContain('HafaShareStore.discardCapture(key)');
    expect(cancel).toContain('files?.cancelAndRemove()');
  });
  it('bundles the Calm fonts and mark into the extension and appends the card sources', () => {
    const files = readFileSync(new URL('writeIosShareExtensionFiles.js', root), 'utf8');
    expect(files).toContain('UIAppFonts: ["Figtree-Regular.ttf", "Figtree-SemiBold.ttf", "Fraunces-Medium.ttf"]');
    expect(files).toContain('"HafaShareContent.swift", "HafaShareKit.swift", "RecipeShareWords.swift", "RecipeShareTheme.swift"');
    const target = readFileSync(new URL('withIosShareExtensionXcodeTarget.js', root), 'utf8');
    for (const name of ['Figtree-Regular.ttf', 'Figtree-SemiBold.ttf', 'Fraunces-Medium.ttf', 'HafaMark.png']) expect(target).toContain(`"${name}"`);
    const theme = card('RecipeShareTheme.swift');
    expect(theme).toContain('regular: "Figtree-Regular", strong: "Figtree-SemiBold", display: "Fraunces-Medium"');
    expect(controller).not.toContain('DMSans');
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
    const action = controller.split(`private func ${name}`)[1].split('\n  }')[0];
    expect(action).toContain('writeCapture(');
  }
  expect(controller).toContain('captureWriting = true');
  expect(controller).toContain('[weak self]');
  expect(controller).toContain('your recipe and last choice are safe.');
  expect(controller).not.toContain('flock(descriptor, LOCK_EX)');
});

it('persists photos before starting any preview and uses file downsampling off main', () => {
  const redirect = section('private func redirectToHostApp', '// The one link');
  expect(redirect).toContain('saveCaptureSource()');
  expect(redirect).not.toContain('describeCapture(');
  const save = section('private func saveCaptureSource', 'private func changeCaptureVisibility');
  expect(save.indexOf('controller.captureDurable = true')).toBeLessThan(save.indexOf('controller.describeCapture('));
  const photos = section('private func handleImages', 'private func documentDirectoryPath');
  expect(photos).toContain('loadFileRepresentation');
  expect(photos).not.toContain('UIImage(');
  const kit = card('HafaShareKit.swift');
  expect(kit).toContain('DispatchQueue.global(qos: .utility)');
  expect(controller).not.toContain('UIImage.init(contentsOfFile:)');
});

it('guards preview networking, bounds its lifetime, and keeps supplied Safari titles', () => {
  expect(section('private func describeCapture', 'private func showCard')).toContain('HafaSharePreviewPolicy.allows(url)');
  expect(controller).toContain('tags?["og:title"]');
  expect(controller).toContain('attributedTitle?.string');
  const kit = card('HafaShareKit.swift');
  expect(kit).toContain('guard HafaSharePreviewPolicy.allows(url) else { return }');
  expect(kit).toContain('provider.shouldFetchSubresources = true');
  expect(kit.indexOf('guard HafaSharePreviewPolicy.allows(url)')).toBeLessThan(kit.indexOf('let provider = LPMetadataProvider()'));
  expect(kit).toContain('provider.timeout = 5');
  expect(kit).toContain('deadline: .now() + 5');
  expect(kit).toContain('linkProvider?.cancel()');
  expect(kit).toContain('previewImageProgress?.cancel()');
  expect(kit).toContain('self.previewGeneration == generation');
  expect(kit).not.toContain('loadObject(ofClass: UIImage.self)');
  expect(section('override func viewWillDisappear', 'private func handleViewLoad')).toContain('card?.cancelPreview()');
  for (const name of ['cancelCapture', 'closeCapture']) expect(controller.split(`private func ${name}`)[1].split('\n  }')[0]).toContain('card?.cancelPreview()');
});

it('gates late attachment callbacks and puts copied photos in a capture-owned directory', () => {
  const photos = section('private func handleImages', 'private func documentDirectoryPath');
  expect(photos).toContain('HafaShareImageTransfer.load(files: files');
  expect(photos).toContain('guard !captureClosed else { return }');
  expect(section('private func redirectToHostApp', '// The one link')).toContain('guard !captureClosed else { return }');
  const cancel = section('private func cancelCapture', 'private func closeCapture');
  expect(cancel).toContain('?? sharedKey');
  expect(cancel).toContain('HafaShareStore.performCaptureWrite');
  expect(cancel).toContain('if discarded { self.closeCapture() }');
});

it('does not log Safari preprocessing dictionaries or other shared payloads', () => {
  const safari = section('private func handlePrepocessing', 'private func handlePkPass');
  expect(safari).toContain('results["baseURI"]');
  expect(safari).not.toContain('NSLog');
  expect(controller).not.toContain('NSLog(');
});

it('supports data/object-only images through the off-main transfer chain', () => {
  const photos = section('private func handleImages', 'private func documentDirectoryPath');
  expect(photos).toContain('loadDataRepresentation');
  expect(photos).toContain('loadObject(ofClass: UIImage.self)');
  expect(photos).toContain('done { image.pngData() }');
  const store = readFileSync(new URL('./modules/hafa-share-bridge/ios/HafaShareShared.swift', import.meta.url), 'utf8');
  expect(store).toContain('DispatchQueue.global(qos: .utility).async');
});
