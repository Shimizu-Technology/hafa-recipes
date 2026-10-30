import React,{act} from 'react';
import {createRoot} from 'test-renderer';
import {expect,it,vi} from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
vi.mock('@clerk/expo',()=>({useAuth:()=>({userId:'subject'})}));
vi.mock('react-native',()=>({Alert:{alert:vi.fn()},View:'View'}));
vi.mock('@/components/Themed',()=>({Button:'Button',Text:'Text'}));
vi.mock('@react-native-async-storage/async-storage',()=>{const data=new Map<string,string>();return {default:{getItem:async(k:string)=>data.get(k)??null,setItem:async(k:string,v:string)=>{data.set(k,v)},getAllKeys:async()=>[...data.keys()],multiRemove:async(ks:string[])=>ks.forEach(k=>data.delete(k))}}});
import {offlineRecipes} from '@/lib/offlineRecipes';
import {OfflineRecipeControl} from './OfflineRecipeControl';
it('never adopts a retained owner A offline pin toggle into owner B storage',async()=>{
 await offlineRecipes.bindSubject('subject');await offlineRecipes.verify('subject','a');
 await offlineRecipes.observe(offlineRecipes.lease('subject')!,{id:'private-a',is_owner:true,extracted:{title:'A secret'}} as any);
 const root=createRoot();
 try{
  await act(async()=>root.render(<OfflineRecipeControl recipeId="private-a" eligible/>));
  const old=root.container.queryAll(node=>node.type==='Button')[0].props.onPress;
  await act(async()=>{await offlineRecipes.verify('subject','b')});
  await act(async()=>{old();await Promise.resolve();});
  expect(await offlineRecipes.list(offlineRecipes.lease('subject')!)).toEqual([]);
 }finally{await act(async()=>root.unmount());await offlineRecipes.clear();}
});
