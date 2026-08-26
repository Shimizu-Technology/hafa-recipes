import type { ShareIntent } from 'expo-share-intent';

import { normalizePastedRecipeText } from './textCapture';

const MAX_SHARED_IMAGES = 10;
const MAX_SHARED_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_SHARED_IMAGES_TOTAL_BYTES = 40 * 1024 * 1024;
const PENDING_CAPTURE_TTL_MS = 5 * 60 * 1000;
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export type SharedRecipeImage = {
  uri: string;
  mimeType: string;
};

export type PendingShareCapture =
  | { kind: 'text'; text: string }
  | { kind: 'images'; images: SharedRecipeImage[] };

export type ShareIntentAction =
  | { kind: 'url'; url: string }
  | { kind: 'text'; text: string }
  | { kind: 'images'; images: SharedRecipeImage[] }
  | { kind: 'sign-in-required' }
  | { kind: 'unsupported'; message: string };

type StagedCapture = {
  token: string;
  createdAt: number;
  capture: PendingShareCapture;
};

let stagedCapture: StagedCapture | null = null;
let captureSequence = 0;
let stagedCaptureExpiry: ReturnType<typeof setTimeout> | null = null;

function extractSharedUrl(shareIntent: ShareIntent): string | null {
  const directUrl = shareIntent.webUrl?.trim() || shareIntent.meta?.url?.trim();
  if (directUrl && /^https?:\/\//i.test(directUrl)) return directUrl;

  const match = shareIntent.text?.match(/https?:\/\/[^\s<>"']+/i);
  return match?.[0] || null;
}

/** Resolve one native share payload into a deterministic application action. */
export function resolveShareIntent(
  shareIntent: ShareIntent,
  isSignedIn: boolean,
): ShareIntentAction {
  const url = extractSharedUrl(shareIntent);
  if (url) return { kind: 'url', url };

  const files = shareIntent.files || [];
  if (files.length > 0) {
    if (!isSignedIn) return { kind: 'sign-in-required' };
    if (files.length > MAX_SHARED_IMAGES) {
      return { kind: 'unsupported', message: 'Share up to 10 recipe images at a time.' };
    }

    const unsupportedFile = files.find(
      (file) => !file.path || !SUPPORTED_IMAGE_TYPES.has(file.mimeType.toLowerCase()),
    );
    if (unsupportedFile) {
      return {
        kind: 'unsupported',
        message: 'Share JPEG, PNG, GIF, or WebP recipe images.',
      };
    }
    const sizes = files.map((file) => file.size);
    const hasVerifiedSizes = sizes.every(
      (size): size is number => typeof size === 'number' && Number.isFinite(size) && size >= 0,
    );
    if (!hasVerifiedSizes) {
      return {
        kind: 'unsupported',
        message: 'Could not verify the size of every recipe image. Save the images, then import them from Håfa Recipes.',
      };
    }
    if (sizes.some((size) => size > MAX_SHARED_IMAGE_BYTES)) {
      return { kind: 'unsupported', message: 'Each recipe image must be 10 MB or smaller.' };
    }

    const totalBytes = sizes.reduce((total, size) => total + size, 0);
    if (totalBytes > MAX_SHARED_IMAGES_TOTAL_BYTES) {
      return {
        kind: 'unsupported',
        message: 'The combined recipe images must be 40 MB or smaller.',
      };
    }

    return {
      kind: 'images',
      images: files.map((file) => ({
        uri: file.path,
        mimeType: file.mimeType.toLowerCase() === 'image/jpg'
          ? 'image/jpeg'
          : file.mimeType.toLowerCase(),
      })),
    };
  }

  const text = normalizePastedRecipeText(shareIntent.text || '');
  if (text) {
    return isSignedIn ? { kind: 'text', text } : { kind: 'sign-in-required' };
  }

  return {
    kind: 'unsupported',
    message: 'Share a recipe link, recipe text, or supported recipe images.',
  };
}

/** Stage sensitive shared content in process memory until its route consumes it. */
export function stagePendingShareCapture(capture: PendingShareCapture): string {
  const token = `share-${Date.now().toString(36)}-${(++captureSequence).toString(36)}`;
  if (stagedCaptureExpiry) clearTimeout(stagedCaptureExpiry);
  stagedCapture = { token, createdAt: Date.now(), capture };
  stagedCaptureExpiry = setTimeout(() => {
    if (stagedCapture?.token === token) stagedCapture = null;
    stagedCaptureExpiry = null;
  }, PENDING_CAPTURE_TTL_MS);
  return token;
}

/** Consume a staged capture once; stale or mismatched route tokens receive nothing. */
export function consumePendingShareCapture(token: string | undefined): PendingShareCapture | null {
  if (!token || !stagedCapture || stagedCapture.token !== token) return null;

  const pending = stagedCapture;
  stagedCapture = null;
  if (stagedCaptureExpiry) clearTimeout(stagedCaptureExpiry);
  stagedCaptureExpiry = null;
  if (Date.now() - pending.createdAt > PENDING_CAPTURE_TTL_MS) return null;
  return pending.capture;
}
