import React, {act} from 'react';
import {createRoot} from 'test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {expect,it,vi} from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const state=vi.hoisted(()=>({sent:vi.fn(async (entry:any)=>({...entry,id:'server-entry'}))}));
vi.mock('@clerk/expo',()=>({useAuth:()=>({isLoaded:true,userId:'subject'})}));
vi.mock('@react-native-async-storage/async-storage',()=>{const data=new Map<string,string>();return {default:{getItem:async(k:string)=>data.get(k)??null,setItem:async(k:string,v:string)=>{data.set(k,v)},getAllKeys:async()=>[...data.keys()],multiRemove:async(ks:string[])=>ks.forEach(k=>data.delete(k))}}});
vi.mock('@/lib/api',()=>({api:{addMealPlanEntry:state.sent}}));
import {offlineRecipes} from '../lib/offlineRecipes';
import {bindRecipeQueryClient} from '../lib/recipeQueryScope';
import {useAddMeal,mealPlanKeys} from './useMealPlan';
const entry={date:'2026-10-31',meal_type:'dinner',recipe_id:'a-private-id',recipe_title:'A family secret',notes:'A private notes'};
const week=()=>({days:[{date:entry.date,breakfast:[],lunch:[],dinner:[],snack:[]}]});
async function fixture(){
 await offlineRecipes.clear();await offlineRecipes.bindSubject('subject');await offlineRecipes.verify('subject','owner-a');state.sent.mockClear();
 const client=new QueryClient({defaultOptions:{mutations:{retry:false}}});bindRecipeQueryClient(client);
 const root=createRoot();let hook:any;
 function Probe(){hook=useAddMeal();return null;}
 await act(async()=>root.render(<QueryClientProvider client={client}><Probe/></QueryClientProvider>));
 return {client,root,get:()=>hook};
}
it('R3 rejects an A callback retained until after stable owner B is verified',async()=>{
 const f=await fixture();const oldMutate=f.get().mutateAsync;
 try{
  await offlineRecipes.verify('subject','owner-b');
  const key=mealPlanKeys.week('2026-10-26');f.client.setQueryData(key,week());
  await act(async()=>{await oldMutate(entry).catch(()=>undefined)});
  console.log('R3 retained callback sent:',state.sent.mock.calls,'B cache:',f.client.getQueryData(key));
  expect.soft(state.sent).not.toHaveBeenCalled();
  expect.soft((f.client.getQueryData(key) as any).days[0].dinner).toEqual([]);
 }finally{await act(async()=>f.root.unmount());f.client.clear();await offlineRecipes.clear();}
});
it('R3 rejects A optimistic continuation after owner B replaces the cancelled query cache',async()=>{
 const f=await fixture();let release!:()=>void;let entered!:()=>void;
 const started=new Promise<void>(resolve=>entered=resolve);
 vi.spyOn(f.client,'cancelQueries').mockImplementationOnce(()=>{entered();return new Promise<void>(resolve=>release=resolve)});
 let pending!:Promise<any>;
 try{
  await act(async()=>{pending=f.get().mutateAsync(entry).catch(()=>undefined);await started;});
  await offlineRecipes.verify('subject','owner-b');
  const key=mealPlanKeys.week('2026-10-26');f.client.setQueryData(key,week());
  await act(async()=>{release();await pending;});
  console.log('R3 retired continuation B cache:',f.client.getQueryData(key));
  expect(state.sent).not.toHaveBeenCalled();
  expect((f.client.getQueryData(key) as any).days[0].dinner).toEqual([]);
 }finally{await act(async()=>f.root.unmount());f.client.clear();await offlineRecipes.clear();}
});

import { useRecipeMutation, useRecipeQueryClient } from './useRecipeQuery';
it.each(['onSuccess','onSettled'] as const)('fences every cache access in an asynchronous %s continuation', async phase => {
 const f=await fixture(); let release!:()=>void;let entered!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve});const gate=new Promise<void>(resolve=>{release=resolve});
 let mutation:any;
 function Probe(){const client=useRecipeQueryClient();mutation=useRecipeMutation({mutationFn:async()=>entry,[phase]:async()=>{entered();await gate;client.setQueryData(mealPlanKeys.week('2026-10-26'),{private:entry});}});return null;}
 let pending!:Promise<any>;
 try{
  await act(async()=>f.root.render(<QueryClientProvider client={f.client}><Probe/></QueryClientProvider>));
  await act(async()=>{pending=mutation.mutateAsync(entry).catch(()=>undefined);await started;});
  const queued:any=f.client.getMutationCache().getAll()[0].state.variables;
  await act(async()=>{await offlineRecipes.verify('subject','owner-b');});
  expect(queued.variables).toBeUndefined();expect(queued.operation.signal.aborted).toBe(true);
  const key=mealPlanKeys.week('2026-10-26');f.client.setQueryData(key,week());
  await act(async()=>{release();await pending;});
  expect((f.client.getQueryData(key) as any).days[0].dinner).toEqual([]);
  expect(JSON.stringify(f.client.getQueryData(key))).not.toContain('A family secret');
 }finally{await act(async()=>f.root.unmount());f.client.clear();await offlineRecipes.clear();}
});
