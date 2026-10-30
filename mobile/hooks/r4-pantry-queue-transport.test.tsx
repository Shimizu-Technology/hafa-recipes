import React, {act} from 'react';
import {createRoot} from 'test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {expect,it,vi} from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const state=vi.hoisted(()=>({sent:vi.fn(),request:null as any,response:null as any,token:'token-a', dispatchGate: null as Promise<unknown> | null, responseGate: null as Promise<unknown> | null, firstGetGate:null as Promise<unknown>|null, gets:0}));
vi.mock('@clerk/expo',()=>({useAuth:()=>({isLoaded:true,userId:'subject'})}));
vi.mock('@react-native-async-storage/async-storage',()=>{const data=new Map<string,string>();return {default:{getItem:async(k:string)=>data.get(k)??null,setItem:async(k:string,v:string)=>{data.set(k,v)},getAllKeys:async()=>[...data.keys()],multiRemove:async(ks:string[])=>ks.forEach(k=>data.delete(k))}}});
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
  return state.response({config,data:method==='get'?{scope:'household',space_id:state.token==='token-a'?'space-a':'space-b',list_id:'list',revision:1,items:[]}:{...entry,id:'server-entry',saved:true}});
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
vi.mock('expo-crypto', () => ({ randomUUID: () => String(Math.random()), CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: async (_: string, value: string) => value }));

import {api} from '../lib/api';
import {offlineRecipes} from '../lib/offlineRecipes';
import {bindRecipeQueryClient} from '../lib/recipeQueryScope';

import {usePantryWrite, useTransferGroceriesToPantry, useCopyPersonalPantry} from './usePantry';
import {bindOfflineGroceryIdentity} from '../lib/offlineStorage';

it('R4 never sends a queued A pantry mutation under B credentials',async()=>{
 await offlineRecipes.clear();await offlineRecipes.bindSubject('subject');await offlineRecipes.verify('subject','owner-a');await bindOfflineGroceryIdentity('subject');
 state.sent.mockClear();state.gets=0;state.token='token-a';state.dispatchGate=null;state.responseGate=null;
 api.setAuthContext(async()=>state.token,'subject');
 let release!:()=>void; state.firstGetGate=new Promise<void>(r=>{release=r});
 const client=new QueryClient({defaultOptions:{mutations:{retry:false}}}); bindRecipeQueryClient(client);
 const root=createRoot();let hook:any;
 function Probe(){hook=usePantryWrite();return null;}
 let first!:Promise<any>,second!:Promise<any>;
 try {
  await act(async()=>root.render(<QueryClientProvider client={client}><Probe/></QueryClientProvider>));
  await act(async()=>{first=hook.mutateAsync({operation:'add',item:{name:'A blocker'}}).catch(()=>undefined)});
  expect(state.gets).toBe(1);
  await act(async()=>{second=hook.mutateAsync({operation:'add',item:{name:'A private queued ingredient',notes:'A secret notes'}}).catch(()=>undefined)});
  await act(async()=>{await offlineRecipes.verify('subject','owner-b')});state.token='token-b';
  await act(async()=>{release();await Promise.all([first,second])});
  console.log('R4 pantry transport calls',JSON.stringify(state.sent.mock.calls));
  expect(state.sent.mock.calls.some(([call])=>call.authorization==='Bearer token-b'&&call.entry?.item?.name==='A private queued ingredient')).toBe(false);
 }finally{release();state.firstGetGate=null;await act(async()=>root.unmount());client.clear();await offlineRecipes.clear();}
});

import { replayPantryWrites } from '../lib/pantryWrites';
it.each(['transfer','copy'] as const)('retires a queued Pantry %s before it can acquire B authority', async kind => {
 await offlineRecipes.clear();await offlineRecipes.bindSubject('subject');await offlineRecipes.verify('subject','owner-a');await bindOfflineGroceryIdentity('subject');
 state.sent.mockClear();state.gets=0;state.token='token-a';api.setAuthContext(async()=>state.token,'subject');
 let release!:()=>void;state.firstGetGate=new Promise<void>(resolve=>{release=resolve});
 const client=new QueryClient({defaultOptions:{mutations:{retry:false}}}),root=createRoot();let hook:any,write:any;
 function Probe(){write=usePantryWrite();const transfer=useTransferGroceriesToPantry(),copy=useCopyPersonalPantry();hook=kind==='transfer'?transfer:copy;return null;}
 try {
  await act(async()=>root.render(<QueryClientProvider client={client}><Probe/></QueryClientProvider>));
  let first!:Promise<any>,second!:Promise<any>;
  await act(async()=>{first=write.mutateAsync({operation:'add',item:{name:'A blocking item'}}).catch(()=>{});});
  await act(async()=>{second=hook.mutateAsync(kind==='copy'?undefined:[{item_id:'A private item',quantity:'1'}]).catch(()=>{});});
  await act(async()=>{await offlineRecipes.verify('subject','owner-b');});state.token='token-b';
  await act(async()=>{release();await Promise.all([first,second]);});
  expect(state.sent.mock.calls.filter(([call])=>call.authorization==='Bearer token-b')).toEqual([]);
  await act(async()=>{await offlineRecipes.verify('subject','owner-a');});state.token='token-a';
  await act(async()=>{await replayPantryWrites();});
  expect(state.sent.mock.calls.some(([call])=>call.entry?.item?.name==='A blocking item'&&call.authorization==='Bearer token-a')).toBe(true);
  expect(state.sent.mock.calls.some(([call])=>kind==='copy'?call.entry?.space_id==='space-a':call.entry?.items?.[0]?.item_id==='A private item')).toBe(true);
 }finally{release();state.firstGetGate=null;await act(async()=>root.unmount());client.clear();await offlineRecipes.clear();}
});
