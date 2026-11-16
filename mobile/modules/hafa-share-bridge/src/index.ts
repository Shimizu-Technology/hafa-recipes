import { requireOptionalNativeModule } from 'expo-modules-core';

type Bridge = {
  getInstallationId(): Promise<string>;
  configureSession(token: string, apiBaseURL: string, accountScopeId: string,
    expiresAt: string, location: string, isPublic: boolean): Promise<void>;
  configurePreferences?(accountScopeId: string, location: string, isPublic: boolean): Promise<void>;
  clearSession(revoke: boolean): Promise<boolean>;
  acknowledgeCapture(captureKey: string): Promise<boolean>;
  discardCapture?(captureKey: string, protectedPaths: string[]): Promise<boolean>;
  cleanupAttachments?(released: string[], protectedPaths: string[]): Promise<string[]>;
  readCaptureMetadata(captureKey: string): Promise<string | null>;
  getCurrentCaptureMetadata(): Promise<string | null>;
};

const bridge = requireOptionalNativeModule<Bridge>('HafaShareBridge');

export const getInstallationId = async () => {
  if (!bridge) throw new Error('Native sharing is not available in this build.');
  return bridge.getInstallationId();
};
export const configureSession = async (token: string, apiBaseURL: string, accountScopeId: string,
  expiresAt: string, location: string, isPublic: boolean) =>
  bridge?.configureSession(token, apiBaseURL, accountScopeId, expiresAt, location, isPublic);
export const configurePreferences = async (accountScopeId: string, location: string, isPublic: boolean) =>
  bridge?.configurePreferences?.(accountScopeId, location, isPublic);
export const clearSession = async (revoke = true) => bridge?.clearSession(revoke) ?? true;
export const acknowledgeCapture = async (captureKey: string) => bridge?.acknowledgeCapture(captureKey) ?? false;
export const discardCapture = async (captureKey: string, protectedPaths: string[] = []) =>
  bridge?.discardCapture?.(captureKey, protectedPaths) ?? bridge?.acknowledgeCapture(captureKey) ?? false;
export const cleanupAttachments = async (released: string[], protectedPaths: string[]) =>
  bridge?.cleanupAttachments?.(released, protectedPaths) ?? released;
export const readCaptureMetadata = async (captureKey: string) => bridge?.readCaptureMetadata(captureKey) ?? null;
export const getCurrentCaptureMetadata = async () => bridge?.getCurrentCaptureMetadata() ?? null;
