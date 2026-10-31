vi.mock('@react-native-community/netinfo', () => ({ default: {} }));
import React, {act} from 'react';
import {createRoot} from 'test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {expect,it,vi} from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const state=vi.hoisted(()=>({sent:vi.fn(),request:null as any,response:null as any,token:'token-a', dispatchGate: null as Promise<unknown> | null, responseGate: null as Promise<unknown> | null}));
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
  if (state.responseGate) await state.responseGate;
  return state.response({config,data:{...entry,id:'server-entry',saved:true}});
 };
 return {interceptors:{request:{use:(fn:any)=>{state.request=fn}},response:{use:(fn:any)=>{state.response=fn}}},
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
import {useAddMeal,mealPlanKeys} from './useMealPlan';
import { useSaveRecipe, useUnsaveRecipe, useUpdateRecipe } from './useRecipes';
import { useAddFromRecipe } from './useGrocery';
import { useRecipeMutation } from './useRecipeQuery';
const entry={date:'2026-10-31',meal_type:'dinner',recipe_id:'a-private-id',recipe_title:'A family secret',notes:'A private notes'};
const week=()=>({days:[{date:entry.date,breakfast:[],lunch:[],dinner:[],snack:[]}]});
async function fixture(){
 await offlineRecipes.clear();await offlineRecipes.bindSubject('subject');await offlineRecipes.verify('subject','owner-a');state.sent.mockClear();state.token='token-a';state.dispatchGate=null;state.responseGate=null;
 const client=new QueryClient({defaultOptions:{mutations:{retry:false}}});bindRecipeQueryClient(client);
 const root=createRoot();let hook:any;
 function Probe(){hook=useAddMeal();return null;}
 await act(async()=>root.render(<QueryClientProvider client={client}><Probe/></QueryClientProvider>));
 return {client,root,get:()=>hook};
}
it('R3 rejects an A callback retained until after stable owner B is verified',async()=>{
 const f=await fixture();const oldMutate=f.get().mutateAsync;api.setAuthContext(async()=>state.token,'subject');
 try{
  await offlineRecipes.verify('subject','owner-b');state.token='token-b';
  const key=mealPlanKeys.week('2026-10-26');f.client.setQueryData(key,week());
  await act(async()=>{await oldMutate(entry).catch(()=>undefined)});
  console.log('R3 retained callback sent:',state.sent.mock.calls,'B cache:',f.client.getQueryData(key));
  expect.soft(state.sent).not.toHaveBeenCalled();
  expect.soft((f.client.getQueryData(key) as any).days[0].dinner).toEqual([]);
 }finally{await act(async()=>f.root.unmount());f.client.clear();await offlineRecipes.clear();}
});

it.each(['save', 'unsave', 'edit', 'plan', 'grocery'] as const)('discards retained detail %s intent before using B credentials or touching B cache', async action => {
 await offlineRecipes.clear(); await offlineRecipes.bindSubject('subject'); await offlineRecipes.verify('subject', 'owner-a');
 state.sent.mockClear(); state.token = 'token-a'; api.setAuthContext(async () => state.token, 'subject');
 const client = new QueryClient({defaultOptions:{mutations:{retry:false}}}); bindRecipeQueryClient(client);
 let mutation: any;
 function Probe() { const save=useSaveRecipe(), unsave=useUnsaveRecipe(), edit=useUpdateRecipe(), plan=useAddMeal(), grocery=useAddFromRecipe(); mutation={save,unsave,edit,plan,grocery}[action];return null; }
 const root = createRoot();
 try {
  await act(async () => root.render(<QueryClientProvider client={client}><Probe/></QueryClientProvider>));
  const retained = mutation.mutateAsync;
  await act(async () => { await offlineRecipes.verify('subject', 'owner-b'); }); state.token='token-b';
  const key=mealPlanKeys.week('2026-10-26'); client.setQueryData(key, week());
  const input=action==='save'||action==='unsave'?'a-private-id':action==='edit'?{id:'a-private-id',update:{notes:'A private notes'}}:action==='plan'?entry:{recipeId:'a-private-id',recipeTitle:'A family secret',ingredients:[{name:'A secret ingredient'}]};
  await act(async () => { await retained(input).catch(() => {}); });
  expect(state.sent).not.toHaveBeenCalled();
  expect(JSON.stringify(client.getQueryCache().getAll().map(query=>query.state.data))).not.toContain('A family secret');
 } finally { await act(async () => root.unmount());client.clear();await offlineRecipes.clear(); }
});

it.each(['token refresh', 'dispatch queue'] as const)('cancels A transport during %s before it can send B token', async pause => {
 const f=await fixture(); let release!: (value?: any) => void;
 const gate = new Promise<string>(resolve=>{release=resolve});
 if(pause==='dispatch queue')state.dispatchGate=gate;
 api.setAuthContext(pause==='token refresh'?()=>gate:async()=>state.token,'subject');
 let pending!: Promise<any>;
 try {
  await act(async () => { pending=f.get().mutateAsync(entry).catch(()=>undefined); });
  await act(async () => { await offlineRecipes.verify('subject','owner-b'); }); state.token='token-b';
  await act(async()=>{release('token-b');await pending;});
  expect(state.sent).not.toHaveBeenCalled();
 } finally {state.dispatchGate=null;state.responseGate=null;await act(async()=>f.root.unmount());f.client.clear();await offlineRecipes.clear();}
});

it('rejects a retained API write method created by A before dispatch under B', async () => {
 const f=await fixture(); const retained=api.addMealPlanEntry;
 try {await offlineRecipes.verify('subject','owner-b'); await expect(retained(entry as any)).rejects.toThrow('account');expect(state.sent).not.toHaveBeenCalled();}
 finally {await act(async()=>f.root.unmount());f.client.clear();await offlineRecipes.clear();}
});

it('does not replay a failed A mutation retry after B becomes current', async () => {
 const f=await fixture(); let fail!: (error: unknown)=>void; let mutation: any;
 const write=vi.fn(()=>new Promise((_resolve,reject)=>{fail=reject}));
 function Retry(){mutation=useRecipeMutation({mutationFn:write,retry:1,retryDelay:0});return null;}
 try {
  await act(async()=>f.root.render(<QueryClientProvider client={f.client}><Retry/></QueryClientProvider>));
  let pending!: Promise<any>;await act(async()=>{pending=mutation.mutateAsync(entry).catch(()=>undefined);});
  await act(async()=>{await offlineRecipes.verify('subject','owner-b');});
  await act(async()=>{fail(new Error('offline'));await pending;});
  expect(write).toHaveBeenCalledOnce(); expect(f.client.getMutationCache().getAll()).toEqual([]);
 } finally {await act(async()=>f.root.unmount());f.client.clear();await offlineRecipes.clear();}
});

it('aborts an in-flight A request and retires its payload before late acknowledgement', async () => {
 const f=await fixture();let finish!:()=>void;state.responseGate=new Promise<void>(resolve=>{finish=resolve});
 api.setAuthContext(async()=>state.token,'subject');let pending!:Promise<any>;
 try {
  await act(async()=>{pending=f.get().mutateAsync(entry).catch(()=>undefined);});
  await vi.waitFor(()=>expect(state.sent).toHaveBeenCalledOnce());
  const intent:any=f.client.getMutationCache().getAll()[0].state.variables;
  const sent=state.sent.mock.calls[0][0];expect(sent.authorization).toBe('Bearer token-a');
  await act(async()=>{await offlineRecipes.verify('subject','owner-b');});
  expect(sent.signal.aborted).toBe(true);expect(intent.variables).toBeUndefined();
  const key=mealPlanKeys.week('2026-10-26');f.client.setQueryData(key,week());
  await act(async()=>{finish();await pending;});
  expect((f.client.getQueryData(key) as any).days[0].dinner).toEqual([]);expect(state.sent).toHaveBeenCalledOnce();
 }finally{state.responseGate=null;await act(async()=>f.root.unmount());f.client.clear();await offlineRecipes.clear();}
});
