import React,{act} from 'react';
import {createRoot} from 'test-renderer';
import {expect,it,vi} from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
vi.mock('@expo/vector-icons/Ionicons',()=>({default:'Ionicons'}));
vi.mock('@clerk/expo',()=>({useAuth:()=>({userId:'subject'})}));
vi.mock('react-native',()=>({Alert:{alert:vi.fn()},View:'View',Switch:'Switch',TouchableOpacity:'TouchableOpacity',StyleSheet:{create:(styles:unknown)=>styles,hairlineWidth:0.5}}));
vi.mock('@/components/Themed',()=>({Text:'Text',useColors:()=>({})}));
vi.mock('@react-native-async-storage/async-storage',()=>{const data=new Map<string,string>();return {default:{getItem:async(k:string)=>data.get(k)??null,setItem:async(k:string,v:string)=>{data.set(k,v)},getAllKeys:async()=>[...data.keys()],multiRemove:async(ks:string[])=>ks.forEach(k=>data.delete(k))}}});
const readRecipe = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: { getRecipe: readRecipe } }));
import {offlineRecipes} from '@/lib/offlineRecipes';
import {OfflineRecipeControl} from './OfflineRecipeControl';
it('never adopts a retained owner A offline pin toggle into owner B storage',async()=>{
 await offlineRecipes.bindSubject('subject');await offlineRecipes.verify('subject','a');
 await offlineRecipes.observe(offlineRecipes.lease('subject')!,{id:'private-a',is_owner:true,extracted:{title:'A secret'}} as any);
 const root=createRoot();
 try{
  await act(async()=>root.render(<OfflineRecipeControl recipeId="private-a" eligible/>));
  const old=root.container.queryAll(node=>node.type==='Switch')[0].props.onValueChange;
  await act(async()=>{await offlineRecipes.verify('subject','b')});
  await act(async()=>{old();await Promise.resolve();});
  expect(await offlineRecipes.list(offlineRecipes.lease('subject')!)).toEqual([]);
 }finally{await act(async()=>root.unmount());await offlineRecipes.clear();}
});

it('fetches a guarded online copy when an eligible recipe has no retained copy', async () => {
 await offlineRecipes.bindSubject('subject'); await offlineRecipes.verify('subject','a');
 readRecipe.mockImplementation(async (_id, _signal, guard) => {
  guard(); await offlineRecipes.observe(offlineRecipes.lease('subject')!, {id:'fresh',is_owner:true,extracted:{title:'Fresh'}} as any);
 });
 const root=createRoot();
 try {
  await act(async()=>root.render(<OfflineRecipeControl recipeId="fresh" eligible/>));
  await act(async()=>{root.container.queryAll(node=>node.type==='Switch')[0].props.onValueChange();});
  expect(readRecipe).toHaveBeenCalledWith('fresh', undefined, expect.any(Function));
  expect((await offlineRecipes.list(offlineRecipes.lease('subject')!))[0].pinned).toBe(true);
 } finally { await act(async()=>root.unmount()); await offlineRecipes.clear(); readRecipe.mockReset(); }
});

it('does not pin into a replacement owner after a pending online read', async () => {
 await offlineRecipes.bindSubject('subject'); await offlineRecipes.verify('subject','a');
 let finish!: () => void;
 readRecipe.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const root=createRoot();
 try {
  await act(async()=>root.render(<OfflineRecipeControl recipeId="pending" eligible/>));
  await act(async()=>{root.container.queryAll(node=>node.type==='Switch')[0].props.onValueChange();});
  await act(async()=>{await offlineRecipes.verify('subject','b'); finish();});
  expect(await offlineRecipes.list(offlineRecipes.lease('subject')!)).toEqual([]);
 } finally { await act(async()=>root.unmount()); await offlineRecipes.clear(); readRecipe.mockReset(); }
});
