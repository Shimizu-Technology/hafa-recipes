import React, {act} from 'react';
import {createRoot} from 'test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {expect,it,vi} from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const state=vi.hoisted(()=>({sent:vi.fn(),request:null as any,response:null as any,token:'token-a', dispatchGate: null as Promise<unknown> | null, responseGate: null as Promise<unknown> | null, firstGetGate:null as Promise<unknown>|null, gets:0, cleanupGate:null as Promise<void>|null}));
vi.mock('@clerk/expo',()=>({useAuth:()=>({isLoaded:true,userId:'subject'})}));
vi.mock('@react-native-async-storage/async-storage',()=>{const data=new Map<string,string>();return {default:{getItem:async(k:string)=>{if(k.endsWith('.pending-image-cleanup')&&state.cleanupGate)await state.cleanupGate;return data.get(k)??null},setItem:async(k:string,v:string)=>{data.set(k,v)},removeItem:async(k:string)=>{data.delete(k)},getAllKeys:async()=>[...data.keys()],multiRemove:async(ks:string[])=>ks.forEach(k=>data.delete(k))}}});
vi.mock('react-native',()=>({Platform:{OS:'ios'}}));
vi.mock('../lib/apiConfig',()=>({API_BASE_URL:'https://api.example.test'}));
vi.mock('../lib/sentry',()=>({addBreadcrumb:vi.fn(),captureError:vi.fn(),captureMessage:vi.fn()}));
vi.mock('axios',()=>({default:{create:()=>{
 const dispatch = async (method: string, url: string, entry: any, options: any = {}) => {
  if (state.dispatchGate) await state.dispatchGate;
  const config = await state.request({...options,url,headers:{},method});
  state.sent({entry,authorization:config.headers.Authorization,signal:config.signal});
  if (method==='get' && ++state.gets===1 && state.firstGetGate) await state.firstGetGate;
  if (state.responseGate) await state.responseGate;
  return state.response({config,data:method==='get'?{scope:'personal',space_id:'space-b',revision:1,items:[]}:{...entry,id:'server-entry',saved:true}});
 };
 return {interceptors:{request:{use:(fn:any)=>{state.request=fn}},response:{use:(fn:any)=>{state.response=fn}}},
 get:(url:string,config:any)=>dispatch('get',url,undefined,config),
 post:(url:string,entry:any,config:any)=>dispatch('post',url,entry,config),
 patch:(url:string,entry:any,config:any)=>dispatch('patch',url,entry,config),
 put:(url:string,entry:any,config:any)=>dispatch('put',url,entry,config),
 delete:(url:string,config:any)=>dispatch('delete',url,undefined,config)};
}}}));
vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ isApiReachable: true }), useOnlineCallback: vi.fn() }));
vi.mock('@/lib/groceryWidget', () => ({ publishConfirmedGrocerySnapshot: vi.fn(async () => {}), requestGroceryWidgetRefresh: vi.fn(async () => {}) }));
vi.mock('../utils/haptics', () => ({ haptics: { success: vi.fn() } }));
vi.mock('../lib/toast', () => ({ showToast: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid', CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: async (_: string, value: string) => value }));

import {api} from '../lib/api';
import {offlineRecipes} from '../lib/offlineRecipes';
import {bindRecipeQueryClient} from '../lib/recipeQueryScope';


import {enqueueChatImageCleanup,activateChatImageCleanup,processChatImageCleanup,resetChatImageCleanupForTests} from '../lib/chatImageCleanup';
import {chatStorageKey} from '../lib/chatStorage';
it('R4 does not send A image cleanup URLs after owner B takes authority',async()=>{
 await offlineRecipes.clear();await offlineRecipes.bindSubject('subject');await offlineRecipes.verify('subject','owner-a');
 state.sent.mockClear();state.token='token-a';state.dispatchGate=null;state.responseGate=null;api.setAuthContext(async()=>state.token,'subject');
 const key=chatStorageKey('owner-a');const url='https://images.example.test/owner-a/private-chat.jpg';
 await enqueueChatImageCleanup(key,{id:'cleanup-a',imageUrls:[url]}); await activateChatImageCleanup(key,'cleanup-a');
 let release!:()=>void; state.cleanupGate=new Promise<void>(r=>{release=r});
 // Same callback used by RecipeChatModal.tsx:402 and :572.
 const pending=processChatImageCleanup(key,(urls)=>api.deleteChatImages(urls));
 await Promise.resolve(); await Promise.resolve();
 try{
  await offlineRecipes.verify('subject','owner-b');state.token='token-b';state.cleanupGate=null;release();await pending;
  console.log('R4 chat cleanup transport',JSON.stringify(state.sent.mock.calls));
  expect(state.sent.mock.calls.some(([call])=>call.authorization==='Bearer token-b'&&call.entry?.image_urls?.includes(url))).toBe(false);
 }finally{state.cleanupGate=null;release();resetChatImageCleanupForTests();await offlineRecipes.clear();}
});
