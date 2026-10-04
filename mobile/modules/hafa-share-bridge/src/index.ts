import { requireOptionalNativeModule } from 'expo-modules-core';

type Bridge = {
  getInstallationId(): Promise<string>;
  configureSession(token: string, apiBaseURL: string, accountScopeId: string,
    expiresAt: string, location: string, isPublic: boolean): Promise<void>;
  clearSession(revoke: boolean): Promise<boolean>;
  acknowledgeCapture(captureKey: string): Promise<boolean>;
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
export const clearSession = async (revoke = true) => bridge?.clearSession(revoke) ?? true;
export const acknowledgeCapture = async (captureKey: string) => bridge?.acknowledgeCapture(captureKey) ?? false;
export const readCaptureMetadata = async (captureKey: string) => bridge?.readCaptureMetadata(captureKey) ?? null;
export const getCurrentCaptureMetadata = async () => bridge?.getCurrentCaptureMetadata() ?? null;
