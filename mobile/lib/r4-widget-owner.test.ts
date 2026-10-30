vi.mock('@react-native-async-storage/async-storage',()=>{const data=new Map<string,string>();return{default:{getItem:async(k:string)=>data.get(k)??null,setItem:async(k:string,v:string)=>{data.set(k,v)},getAllKeys:async()=>[...data.keys()],multiRemove:async(ks:string[])=>{ks.forEach(k=>data.delete(k))}}};});
import {offlineRecipes} from './offlineRecipes';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureValues = vi.hoisted(() => new Map<string, string>());
const bridge = vi.hoisted(() => ({
  isAvailable: true,
  configureSession: vi.fn(),
  updateSnapshot: vi.fn(),
  getSessionStatus: vi.fn(),
  flushPending: vi.fn(),
  clearSession: vi.fn(),
  retireSession: vi.fn(), restorePending: vi.fn(async () => {}), discardPending: vi.fn(async () => {}),
}));
const apiMock = vi.hoisted(() => ({
  getGrocerySnapshot: vi.fn(),
  issueGroceryWidgetCredential: vi.fn(),
  revokeGroceryWidgetCredential: vi.fn(),
}));

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: vi.fn(async (key: string) => secureValues.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureValues.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureValues.delete(key);
  }),
}));
vi.mock('expo-crypto', async () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: async (_algorithm: string, text: string) => (await vi.importActual<any>('node:crypto')).createHash('sha256').update(text).digest('hex'),
  randomUUID: vi.fn(() => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
}));
vi.mock('hafa-widget-bridge', () => ({ HafaWidgetBridge: bridge }));
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('@/lib/apiConfig', () => ({ API_BASE_URL: 'https://api.example.com' }));

import {
  bindGroceryWidgetIdentity,
  parseStoredGroceryWidgetSession,
  shouldRenewGroceryWidgetSession,
  synchronizeGroceryWidget,
  toWidgetGrocerySnapshot, publishConfirmedGrocerySnapshot,
  type StoredGroceryWidgetSession,
} from './groceryWidget';
import type { GrocerySnapshot } from '@/types/recipe';

const SESSION_KEY = 'hafa.grocery-widget.session-metadata.v1';
const LIST_ID = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL_ID = '22222222-2222-4222-8222-222222222222';

function snapshot(): GrocerySnapshot {
  return {
    account_scope_id: 'scope-one',
    list: {
      id: LIST_ID,
      name: 'Our list',
      is_shared: true,
      members: [
        {
          user_id: 'stable-private-user-id',
          display_name: 'Leon',
          joined_at: '2026-08-01T00:00:00Z',
          is_you: true,
        },
      ],
      revision: 4,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-23T00:00:00Z',
    },
    items: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Rice',
        quantity: '1',
        unit: 'bag',
        notes: null,
        checked: false,
        recipe_id: null,
        recipe_title: null,
        added_by_name: 'Leon',
        created_at: '2026-08-23T00:00:00Z',
        updated_at: '2026-08-23T00:00:00Z',
      },
    ],
    total: 1,
    unchecked: 1,
    checked: 0,
    server_time: '2026-08-23T00:00:00Z',
  };
}

function storedSession(overrides: Partial<StoredGroceryWidgetSession> = {}) {
  return {
    version: 1 as const,
    clerkUserId: 'clerk-user-one',
    credentialId: CREDENTIAL_ID,
    accountScopeId: 'scope-one',
    listId: LIST_ID,
    expiresAt: '2027-01-01T00:00:00Z',
    ...overrides,
  };
}

  beforeEach(() => {
    secureValues.clear();
    vi.clearAllMocks();
    bridge.isAvailable = true;
    bridge.configureSession.mockResolvedValue(undefined);
    bridge.updateSnapshot.mockResolvedValue(undefined);
    bridge.flushPending.mockResolvedValue(undefined);
    bridge.clearSession.mockResolvedValue(true);
    bridge.retireSession.mockImplementation(async () => { await bridge.clearSession(true); return true; });
    bridge.getSessionStatus.mockResolvedValue({
      available: true,
      hasCredential: false,
      accountScopeId: null,
      listId: null,
      pendingCount: 0,
      requiresReconnect: false,
    });
  });

  it('R4 scrubs A widget and never flushes its pending mutations when same subject becomes B',async()=>{
    await offlineRecipes.clear();await offlineRecipes.bindSubject('clerk-user-one');await offlineRecipes.verify('clerk-user-one','owner-a');
    secureValues.set(SESSION_KEY,JSON.stringify(storedSession()));
    bridge.getSessionStatus.mockResolvedValue({hasCredential:true,requiresReconnect:false,accountScopeId:'scope-one',listId:LIST_ID});
    await bindGroceryWidgetIdentity('clerk-user-one'); bridge.clearSession.mockClear();bridge.flushPending.mockClear();
    try{
      await offlineRecipes.verify('clerk-user-one','owner-b');
      await bindGroceryWidgetIdentity('clerk-user-one');
      // Offline B cannot replace the snapshot; A's native bearer must be retired before any flush.
      apiMock.getGrocerySnapshot.mockRejectedValue(new Error('offline'));
      await synchronizeGroceryWidget('clerk-user-one').catch(()=>undefined);
      console.log('R4 widget clear calls',bridge.clearSession.mock.calls.length,'A pending flush calls',bridge.flushPending.mock.calls.length);
      expect.soft(bridge.clearSession).toHaveBeenCalled();expect(bridge.flushPending).not.toHaveBeenCalled();
    }finally{await offlineRecipes.clear();}
  });

  it('retires queued widget publication and restores pending work only for the returning owner',async()=>{
    await offlineRecipes.bindSubject('clerk-user-one');await offlineRecipes.verify('clerk-user-one','owner-a');
    let finish!:(value:GrocerySnapshot)=>void;
    apiMock.getGrocerySnapshot.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
    const first=synchronizeGroceryWidget('clerk-user-one').catch(()=>undefined);
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    const queued=publishConfirmedGrocerySnapshot(snapshot()).catch(()=>undefined);
    await offlineRecipes.verify('clerk-user-one','owner-b');finish(snapshot());await Promise.all([first,queued]);
    expect(bridge.updateSnapshot).not.toHaveBeenCalled();expect(bridge.flushPending).not.toHaveBeenCalled();
    expect(bridge.retireSession).toHaveBeenCalledWith('owner-a');
    await offlineRecipes.verify('clerk-user-one','owner-a');
    apiMock.getGrocerySnapshot.mockResolvedValue(snapshot());
    apiMock.issueGroceryWidgetCredential.mockResolvedValue({credential_id:CREDENTIAL_ID,token:`hfw_v1.${CREDENTIAL_ID}.abcdefghijklmnopqrstuvwxyzABCDEFGH1234567890_-`,list_id:LIST_ID,account_scope_id:'scope-one',scopes:['grocery:read','grocery:set_checked'],issued_at:'2026-08-23T00:00:00Z',expires_at:'2027-11-21T00:00:00Z'});
    await synchronizeGroceryWidget('clerk-user-one');expect(bridge.restorePending).toHaveBeenCalledWith('owner-a');
    await offlineRecipes.clear();
  });


import * as SecureStore from 'expo-secure-store';
it('removes a widget metadata write dispatched before retirement but completed afterwards',async()=>{
 await offlineRecipes.bindSubject('clerk-user-one');await offlineRecipes.verify('clerk-user-one','owner-a');
 apiMock.getGrocerySnapshot.mockResolvedValue(snapshot());
 apiMock.issueGroceryWidgetCredential.mockResolvedValue({credential_id:CREDENTIAL_ID,token:`hfw_v1.${CREDENTIAL_ID}.abcdefghijklmnopqrstuvwxyzABCDEFGH1234567890_-`,list_id:LIST_ID,account_scope_id:'scope-one',scopes:['grocery:read','grocery:set_checked'],issued_at:'2026-08-23T00:00:00Z',expires_at:'2027-11-21T00:00:00Z'});
 let finish!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>{entered=r}),gate=new Promise<void>(r=>{finish=r});
 const spy=vi.spyOn(SecureStore,'setItemAsync').mockImplementation(async(key,value)=>{if(key===SESSION_KEY){entered();await gate;}secureValues.set(key,value)});
 const pending=synchronizeGroceryWidget('clerk-user-one').catch(()=>undefined);
 try{await started;await offlineRecipes.verify('clerk-user-one','owner-b');finish();await pending;expect(secureValues.has(SESSION_KEY)).toBe(false);}
 finally{finish();spy.mockRestore();await offlineRecipes.clear();}
});

it('serializes successive owner retirements before a replacement widget can publish',async()=>{
 await offlineRecipes.bindSubject('clerk-user-one');await offlineRecipes.verify('clerk-user-one','owner-a');
 let finish!:()=>void;const gate=new Promise<void>(resolve=>{finish=resolve});
 bridge.retireSession.mockReset().mockImplementationOnce(()=>gate).mockResolvedValue(true);
 await offlineRecipes.verify('clerk-user-one','owner-b');await vi.waitFor(()=>expect(bridge.retireSession).toHaveBeenCalledWith('owner-a'));
 await offlineRecipes.verify('clerk-user-one','owner-c');
 try{expect(bridge.retireSession.mock.calls.map(args=>args[0])).toEqual(['owner-a']);}
 finally{finish();await bindGroceryWidgetIdentity('clerk-user-one');await offlineRecipes.clear();}
 expect(bridge.retireSession.mock.calls.slice(0,2).map(args=>args[0])).toEqual(['owner-a','owner-b']);
});

it('preserves a 2.6 widget queue by API owner namespace and restores it only to that owner',async()=>{
 await offlineRecipes.bindSubject('clerk-user-one');await offlineRecipes.verify('clerk-user-one','owner-b');
 secureValues.set(SESSION_KEY,JSON.stringify(storedSession({accountScopeId:'gacct_owner_a'})));
 bridge.getSessionStatus.mockResolvedValue({hasCredential:true,requiresReconnect:false,accountScopeId:'gacct_owner_a',listId:LIST_ID});
 await bindGroceryWidgetIdentity('clerk-user-one');expect(bridge.retireSession).toHaveBeenCalledWith('legacy-scope:gacct_owner_a');expect(bridge.flushPending).not.toHaveBeenCalled();
 bridge.getSessionStatus.mockResolvedValue({hasCredential:false,accountScopeId:null,listId:null,requiresReconnect:false});
 await offlineRecipes.verify('clerk-user-one','owner-a');
 apiMock.getGrocerySnapshot.mockResolvedValue({...snapshot(),account_scope_id:'gacct_owner_a'});
 apiMock.issueGroceryWidgetCredential.mockResolvedValue({credential_id:CREDENTIAL_ID,token:`hfw_v1.${CREDENTIAL_ID}.abcdefghijklmnopqrstuvwxyzABCDEFGH1234567890_-`,list_id:LIST_ID,account_scope_id:'gacct_owner_a',scopes:['grocery:read','grocery:set_checked'],issued_at:'2026-08-23T00:00:00Z',expires_at:'2027-11-21T00:00:00Z'});
 await synchronizeGroceryWidget('clerk-user-one');expect(bridge.restorePending).toHaveBeenCalledWith('legacy-scope:gacct_owner_a');expect(bridge.restorePending).toHaveBeenCalledWith('owner-a');expect(bridge.flushPending).toHaveBeenCalledOnce();await offlineRecipes.clear();
});
import { groceryAccountScope } from './groceryAccountScope';
it('matches the API stable-owner namespace for legacy archive deletion',async()=>{
 expect(await groceryAccountScope('owner-a')).toBe('gacct_EO0nnVrx2oEWi5C9zi10HtyA');
});

it.each([1, 2])('retires a configured capability when foreground publication expires during restore %s', async (restoreNumber) => {
 await offlineRecipes.bindSubject('clerk-user-one'); await offlineRecipes.verify('clerk-user-one','owner-a');
 apiMock.getGrocerySnapshot.mockResolvedValue(snapshot());
 apiMock.issueGroceryWidgetCredential.mockResolvedValue({credential_id:CREDENTIAL_ID,token:`hfw_v1.${CREDENTIAL_ID}.abcdefghijklmnopqrstuvwxyzABCDEFGH1234567890_-`,list_id:LIST_ID,account_scope_id:'scope-one',scopes:['grocery:read','grocery:set_checked'],issued_at:'2026-08-23T00:00:00Z',expires_at:'2027-11-21T00:00:00Z'});
 let current=true, release!:()=>void; const gate=new Promise<void>(r=>{release=r});
 bridge.restorePending.mockReset().mockImplementation(async()=>{ if(bridge.restorePending.mock.calls.length===restoreNumber) await gate; });
 const pending=synchronizeGroceryWidget('clerk-user-one',()=>current);
 try {
   await vi.waitFor(()=>expect(bridge.restorePending).toHaveBeenCalledTimes(restoreNumber));
   current=false; release(); await pending;
   expect(bridge.retireSession).toHaveBeenCalledWith('owner-a');
   expect(bridge.clearSession).toHaveBeenCalledWith(true);
   expect(bridge.flushPending).not.toHaveBeenCalled();
   expect(secureValues.has(SESSION_KEY)).toBe(false);
 } finally { release(); await offlineRecipes.clear(); }
});
