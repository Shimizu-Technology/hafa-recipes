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

/** Sections folded on the widget, for the account and list it currently shows. */
export type HafaWidgetCollapsedSections = {
  accountScopeId: string | null;
  listId: string | null;
  keys: string[];
  /** Milliseconds since 1970, or null when the widget never recorded a change. */
  updatedAt: number | null;
};

type HafaWidgetBridgeNativeModule = {
  configureSession(token: string, apiBaseUrl: string, snapshotJson: string): Promise<void>;
  updateSnapshot(snapshotJson: string): Promise<void>;
  getSessionStatus(): Promise<HafaWidgetSessionStatus>;
  flushPending(): Promise<void>;
  retireSession(owner: string): Promise<boolean>;
  restorePending(owner: string): Promise<void>;
  discardPending(owner: string): Promise<void>;
  clearSession(revoke: boolean): Promise<boolean>;
  // Added after the first widget release; older binaries lack them.
  getCollapsedSections?(): Promise<HafaWidgetCollapsedSections>;
  setCollapsedSections?(accountScopeId: string, listId: string, keys: string[], updatedAt: number): Promise<boolean>;
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

  async retireSession(owner: string) { return (await nativeModule?.retireSession(owner)) ?? false; },
  async restorePending(owner: string) { await nativeModule?.restorePending(owner); },
  async discardPending(owner: string) { await nativeModule?.discardPending(owner); },

  async clearSession(revoke = true): Promise<boolean> {
    return (await nativeModule?.clearSession(revoke)) ?? false;
  },

  async getCollapsedSections(): Promise<HafaWidgetCollapsedSections | null> {
    return (await nativeModule?.getCollapsedSections?.()) ?? null;
  },

  /** Returns false when the widget shows another account's view, another list or none. */
  async setCollapsedSections(accountScopeId: string, listId: string, keys: string[], updatedAt: number): Promise<boolean> {
    if (!accountScopeId || !listId) return false;
    return (await nativeModule?.setCollapsedSections?.(accountScopeId, listId, keys, updatedAt)) ?? false;
  },
};
