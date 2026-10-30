import { groceryAccountScope } from './groceryAccountScope';
import { offlineRecipes } from './offlineRecipes';
import { assertRecipeScope, recipeScope } from './recipeQueryScope';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { HafaWidgetBridge } from 'hafa-widget-bridge';

import { api } from '@/lib/api';
import { API_BASE_URL } from '@/lib/apiConfig';
import type {
  GroceryItem,
  GrocerySnapshot,
  GroceryWidgetCredential,
} from '@/types/recipe';

const INSTALLATION_ID_KEY = 'hafa.grocery-widget.installation-id.v1';
const SESSION_METADATA_KEY = 'hafa.grocery-widget.session-metadata.v1';
const RENEWAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN =
  /^hfw_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{20,128}$/i;
const EXPECTED_SCOPES = ['grocery:read', 'grocery:set_checked'];
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface StoredGroceryWidgetSession {
  owner?: string | null;
  version: 1;
  clerkUserId: string;
  credentialId: string;
  accountScopeId: string;
  listId: string;
  expiresAt: string;
}

export interface WidgetGrocerySnapshot {
  account_scope_id: string;
  list: {
    id: string;
    name: string;
    is_shared: boolean;
    revision: number;
    created_at: string;
    updated_at: string;
  };
  items: Array<Pick<
    GroceryItem,
    | 'id'
    | 'name'
    | 'quantity'
    | 'unit'
    | 'notes'
    | 'checked'
    | 'recipe_id'
    | 'recipe_title'
    | 'added_by_name'
    | 'created_at'
    | 'updated_at'
  >>;
  total: number;
  unchecked: number;
  checked: number;
  server_time: string;
}

let widgetStateQueue: Promise<unknown> = Promise.resolve();
let retirement: Promise<unknown> = Promise.resolve();
const legacyOwner = (scope: string) => `legacy-scope:${scope}`;
function retireNativeSession(owner: string) {
  // Every path uses one chain; a later owner cannot archive an earlier queue.
  retirement = retirement.then(() => HafaWidgetBridge.retireSession(owner))
    .then(() => deleteStoredSession()).catch(() => undefined);
  return retirement;
}
const refreshListeners = new Set<() => void>();

function serializeWidgetState<T>(operation: (guard: () => void) => Promise<T>): Promise<T> {
  const scope = recipeScope();
  const guard = () => assertRecipeScope(scope);
  const run = async () => { guard(); await retirement; guard(); const result = await operation(guard); guard(); return result; };
  const result = widgetStateQueue.then(run, run);
  widgetStateQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function isStoredSession(value: unknown): value is StoredGroceryWidgetSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredGroceryWidgetSession>;
  return (
    (candidate.owner == null || typeof candidate.owner === 'string' && candidate.owner.length > 0 && candidate.owner.length <= 256) &&
    candidate.version === 1 &&
    typeof candidate.clerkUserId === 'string' &&
    candidate.clerkUserId.length > 0 &&
    candidate.clerkUserId.length <= 256 &&
    typeof candidate.credentialId === 'string' &&
    UUID_PATTERN.test(candidate.credentialId) &&
    typeof candidate.accountScopeId === 'string' &&
    candidate.accountScopeId.length > 0 &&
    candidate.accountScopeId.length <= 256 &&
    typeof candidate.listId === 'string' &&
    UUID_PATTERN.test(candidate.listId) &&
    typeof candidate.expiresAt === 'string' &&
    Number.isFinite(Date.parse(candidate.expiresAt))
  );
}

function isValidCredential(value: GroceryWidgetCredential): boolean {
  return (
    UUID_PATTERN.test(value.credential_id) &&
    TOKEN_PATTERN.test(value.token) &&
    UUID_PATTERN.test(value.list_id) &&
    value.account_scope_id.length > 0 &&
    value.account_scope_id.length <= 256 &&
    value.scopes.length === EXPECTED_SCOPES.length &&
    EXPECTED_SCOPES.every((scope) => value.scopes.includes(scope)) &&
    Number.isFinite(Date.parse(value.issued_at)) &&
    Number.isFinite(Date.parse(value.expires_at)) &&
    Date.parse(value.expires_at) > Date.parse(value.issued_at)
  );
}

export function parseStoredGroceryWidgetSession(
  serialized: string | null,
): StoredGroceryWidgetSession | null {
  if (!serialized) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isStoredSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function shouldRenewGroceryWidgetSession(
  session: StoredGroceryWidgetSession,
  nowMs = Date.now(),
): boolean {
  return Date.parse(session.expiresAt) <= nowMs + RENEWAL_WINDOW_MS;
}

export function toWidgetGrocerySnapshot(snapshot: GrocerySnapshot): WidgetGrocerySnapshot {
  return {
    account_scope_id: snapshot.account_scope_id,
    list: {
      id: snapshot.list.id,
      name: snapshot.list.name,
      is_shared: snapshot.list.is_shared,
      revision: snapshot.list.revision,
      created_at: snapshot.list.created_at,
      updated_at: snapshot.list.updated_at,
    },
    items: snapshot.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      notes: item.notes,
      checked: item.checked,
      recipe_id: item.recipe_id,
      recipe_title: item.recipe_title,
      added_by_name: item.added_by_name,
      created_at: item.created_at,
      updated_at: item.updated_at,
    })),
    total: snapshot.total,
    unchecked: snapshot.unchecked,
    checked: snapshot.checked,
    server_time: snapshot.server_time,
  };
}

async function loadStoredSession(): Promise<StoredGroceryWidgetSession | null> {
  const serialized = await SecureStore.getItemAsync(SESSION_METADATA_KEY);
  const session = parseStoredGroceryWidgetSession(serialized);
  if (!session && serialized) {
    await SecureStore.deleteItemAsync(SESSION_METADATA_KEY);
  }
  return session;
}

async function getOrCreateInstallationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
  if (existing && UUID_PATTERN.test(existing)) return existing;
  const installationId = Crypto.randomUUID();
  await SecureStore.setItemAsync(
    INSTALLATION_ID_KEY,
    installationId,
    SECURE_STORE_OPTIONS,
  );
  return installationId;
}

async function deleteStoredSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_METADATA_KEY);
}

async function bindIdentityUnsafe(clerkUserId: string | null, guard: () => void): Promise<void> {
  if (!HafaWidgetBridge.isAvailable) return;
  const [stored, status] = await Promise.all([
    loadStoredSession(),
    HafaWidgetBridge.getSessionStatus(),
  ]);
  guard();
  const belongsToCurrentUser = stored?.clerkUserId === clerkUserId && (stored.owner ?? null) === JSON.parse(recipeScope())[1];
  const hasNativeState = status.hasCredential || status.listId !== null;
  const hasCompleteMatchingSession =
    Boolean(clerkUserId) &&
    belongsToCurrentUser &&
    status.hasCredential &&
    !status.requiresReconnect &&
    status.accountScopeId === stored?.accountScopeId &&
    status.listId === stored?.listId;

  if (hasCompleteMatchingSession) return;
  if (stored || hasNativeState) {
    // The widget bearer can revoke itself even after Clerk signs out or changes
    // accounts. Local state is always scrubbed whether that request succeeds.
    const owner = stored?.owner && status.accountScopeId === stored.accountScopeId && status.listId === stored.listId
      ? stored.owner : status.accountScopeId ? legacyOwner(status.accountScopeId) : null;
    if (owner) await retireNativeSession(owner);
    else await HafaWidgetBridge.clearSession(true);
  }
  guard(); await deleteStoredSession();
}

export function bindGroceryWidgetIdentity(clerkUserId: string | null): Promise<void> {
  return serializeWidgetState(guard => bindIdentityUnsafe(clerkUserId, guard));
}

async function revokeBearerToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchImpl(`${API_BASE_URL}/api/grocery/widget/session`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // The server credential remains revocable, device scoped, and expiring. The
    // token is never persisted by JavaScript when provisioning is abandoned.
  }
}

async function provisionSession(
  clerkUserId: string,
  snapshot: GrocerySnapshot,
  isCurrent: () => boolean,
): Promise<void> {
  const installationId = await getOrCreateInstallationId();
  if (!isCurrent()) return;

  const credential = await api.issueGroceryWidgetCredential(
    installationId,
    () => {
      if (!isCurrent()) throw new Error('Widget identity changed');
    },
  );
  if (
    !isValidCredential(credential) ||
    credential.list_id !== snapshot.list.id ||
    credential.account_scope_id !== snapshot.account_scope_id
  ) {
    await revokeBearerToken(credential.token);
    throw new Error('The grocery widget credential response is invalid');
  }
  if (!isCurrent()) {
    await revokeBearerToken(credential.token);
    return;
  }

  const stored: StoredGroceryWidgetSession = {
    version: 1,
    owner: JSON.parse(recipeScope())[1],
    clerkUserId,
    credentialId: credential.credential_id,
    accountScopeId: credential.account_scope_id,
    listId: credential.list_id,
    expiresAt: credential.expires_at,
  };

  try {
    await HafaWidgetBridge.configureSession(
      credential.token,
      API_BASE_URL,
      JSON.stringify(toWidgetGrocerySnapshot(snapshot)),
    );
    if (isCurrent()) {
      const owner = JSON.parse(recipeScope())[1];
      if (owner) {
        await HafaWidgetBridge.restorePending(legacyOwner(snapshot.account_scope_id));
        if (!isCurrent()) return;
        await HafaWidgetBridge.restorePending(owner);
        if (!isCurrent()) return;
        await HafaWidgetBridge.flushPending();
      }
    }
    if (!isCurrent()) {
      await HafaWidgetBridge.clearSession(true);
      return;
    }
    await SecureStore.setItemAsync(
      SESSION_METADATA_KEY,
      JSON.stringify(stored),
      SECURE_STORE_OPTIONS,
    );
    if (!isCurrent()) await deleteStoredSession();
  } catch (error) {
    await HafaWidgetBridge.clearSession(true).catch(() => false);
    await revokeBearerToken(credential.token);
    await deleteStoredSession().catch(() => undefined);
    throw error;
  }
}

export function synchronizeGroceryWidget(
  clerkUserId: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const authority = recipeScope(), current = isCurrent;
  isCurrent = () => authority === recipeScope() && current();
  return serializeWidgetState(async guard => {
    if (!HafaWidgetBridge.isAvailable || !isCurrent()) return;
    await bindIdentityUnsafe(clerkUserId, guard);
    if (!isCurrent()) return;

    let stored = await loadStoredSession();
    let status = await HafaWidgetBridge.getSessionStatus();
    guard();
    if (
      stored?.clerkUserId === clerkUserId &&
      status.hasCredential &&
      !status.requiresReconnect
    ) {
      guard();
      await HafaWidgetBridge.flushPending();
      if (!isCurrent()) return;
      stored = await loadStoredSession();
      status = await HafaWidgetBridge.getSessionStatus();
    }

    const snapshot = await api.getGrocerySnapshot();
    if (!isCurrent()) return;
    const canReuseSession =
      stored?.clerkUserId === clerkUserId &&
      stored.accountScopeId === snapshot.account_scope_id &&
      stored.listId === snapshot.list.id &&
      status.hasCredential &&
      !status.requiresReconnect &&
      status.accountScopeId === snapshot.account_scope_id &&
      status.listId === snapshot.list.id &&
      !shouldRenewGroceryWidgetSession(stored);

    if (canReuseSession) {
      guard();
    await HafaWidgetBridge.updateSnapshot(
        JSON.stringify(toWidgetGrocerySnapshot(snapshot)),
      );
      return;
    }
    await provisionSession(clerkUserId, snapshot, isCurrent);
  });
}

export function publishConfirmedGrocerySnapshot(snapshot: GrocerySnapshot): Promise<void> {
  return serializeWidgetState(async guard => {
    if (!HafaWidgetBridge.isAvailable) return;
    const stored = await loadStoredSession();
    guard();
    if (
      !stored ||
      stored.accountScopeId !== snapshot.account_scope_id ||
      stored.listId !== snapshot.list.id ||
      shouldRenewGroceryWidgetSession(stored)
    ) {
      requestGroceryWidgetRefresh();
      return;
    }
    guard();
    await HafaWidgetBridge.updateSnapshot(
      JSON.stringify(toWidgetGrocerySnapshot(snapshot)),
    );
  });
}

export function clearGroceryWidgetSession(revokeWithApp = false, deletedOwner?: string): Promise<void> {
  return serializeWidgetState(async guard => {
    if (!HafaWidgetBridge.isAvailable) return;
    const stored = await loadStoredSession();
    guard();
    if (deletedOwner) {
      await HafaWidgetBridge.discardPending(deletedOwner);
      const scope = await groceryAccountScope(deletedOwner); guard();
      await HafaWidgetBridge.discardPending(legacyOwner(scope));
    }
    guard();
    if (revokeWithApp && stored) {
      await api.revokeGroceryWidgetCredential(stored.credentialId).catch(() => undefined);
    }
    await HafaWidgetBridge.clearSession(true).catch(() => false);
    await deleteStoredSession();
  });
}

export function subscribeToGroceryWidgetRefresh(listener: () => void): () => void {
  refreshListeners.add(listener);
  return () => refreshListeners.delete(listener);
}

export function requestGroceryWidgetRefresh(): void {
  refreshListeners.forEach((listener) => listener());
}

// Native revocation scrubs the rendered list before its best-effort network await.
// Start retirement immediately, ahead of any blocked JS synchronization queue.
offlineRecipes.onRetire(previous => {
  if (!previous || !HafaWidgetBridge.isAvailable) return;
  void retireNativeSession(previous.owner);
});
