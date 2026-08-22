import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type HafaWidgetSessionStatus = {
  available: boolean;
  hasCredential: boolean;
  accountScopeId: string | null;
  listId: string | null;
  pendingCount: number;
  requiresReconnect: boolean;
};

type HafaWidgetBridgeNativeModule = {
  configureSession(token: string, apiBaseUrl: string, snapshotJson: string): Promise<void>;
  updateSnapshot(snapshotJson: string): Promise<void>;
  getSessionStatus(): Promise<HafaWidgetSessionStatus>;
  flushPending(): Promise<void>;
  clearSession(revoke: boolean): Promise<boolean>;
};

const nativeModule =
  Platform.OS === 'ios'
    ? requireOptionalNativeModule<HafaWidgetBridgeNativeModule>('HafaWidgetBridge')
    : null;

const unavailableStatus: HafaWidgetSessionStatus = {
  available: false,
  hasCredential: false,
  accountScopeId: null,
  listId: null,
  pendingCount: 0,
  requiresReconnect: false,
};

export const HafaWidgetBridge = {
  isAvailable: nativeModule !== null,

  async configureSession(token: string, apiBaseUrl: string, snapshotJson: string) {
    await nativeModule?.configureSession(token, apiBaseUrl, snapshotJson);
  },

  async updateSnapshot(snapshotJson: string) {
    await nativeModule?.updateSnapshot(snapshotJson);
  },

  async getSessionStatus(): Promise<HafaWidgetSessionStatus> {
    return (await nativeModule?.getSessionStatus()) ?? unavailableStatus;
  },

  async flushPending() {
    await nativeModule?.flushPending();
  },

  async clearSession(revoke = true): Promise<boolean> {
    return (await nativeModule?.clearSession(revoke)) ?? false;
  },
};
