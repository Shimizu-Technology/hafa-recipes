import React,{act} from 'react';
import {createRoot} from 'test-renderer';
import {expect,it,vi} from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const data=vi.hoisted(()=>new Map<string,string>());
vi.mock('@react-native-async-storage/async-storage',()=>({default:{getItem:async(k:string)=>data.get(k)??null,setItem:async(k:string,v:string)=>{data.set(k,v)},removeItem:async(k:string)=>{data.delete(k)},getAllKeys:async()=>[...data.keys()],multiRemove:async(ks:string[])=>{ks.forEach(k=>data.delete(k))}}}));
import {offlineRecipes} from '../lib/offlineRecipes';
import {privateRecipeDrafts} from '../lib/privateRecipeDrafts';
import {useScaledServings} from './useScaledServings';
import {stagePendingShareCapture,consumePendingShareCapture} from '../lib/shareCapture';
async function ownerA(){data.clear();await offlineRecipes.clear();await offlineRecipes.bindSubject('subject');await offlineRecipes.verify('subject','owner-a');}
it('R4 does not restore A serving preference when B opens the same recipe',async()=>{
 await ownerA();let hook:any;function Probe(){hook=useScaledServings('shared-recipe',4);return null;}
 const a=createRoot(),b=createRoot();
 try{await act(async()=>a.render(<Probe/>));await act(async()=>hook.setScaledServings(8));await act(async()=>a.unmount());
 await offlineRecipes.verify('subject','owner-b');await act(async()=>b.render(<Probe/>));
 console.log('R4 B servings',hook.currentServings);expect(hook.currentServings).toBe(4);
 }finally{await act(async()=>b.unmount());await offlineRecipes.clear();}
});
it('R4 refuses an A serving callback retained after B changes owner',async()=>{
 await ownerA();let hook:any;function Probe(){hook=useScaledServings('shared-recipe',4);return null;}const root=createRoot();
 try{await act(async()=>root.render(<Probe/>));const retained=hook.setScaledServings;
 await act(async()=>{await offlineRecipes.verify('subject','owner-b');root.unmount();});await retained(12);
 console.log('R4 retained serving disk',data.get('scaled_servings_shared-recipe'));expect(data.has('scaled_servings_shared-recipe')).toBe(false);
 }finally{await offlineRecipes.clear();}
});

it('restores committed servings only to their stable owner after A returns', async()=>{
 await ownerA();let hook:any;function Probe(){hook=useScaledServings('shared',4);return null;}const root=createRoot();
 try{await act(async()=>root.render(<Probe/>));await act(async()=>hook.setScaledServings(8));const retained=hook.setScaledServings;
 await act(async()=>{await offlineRecipes.verify('subject','owner-b')});expect(hook.currentServings).toBe(4);
 await act(async()=>{await offlineRecipes.verify('subject','owner-a')});expect(hook.currentServings).toBe(8);await act(async()=>retained(12));expect(hook.currentServings).toBe(8);
 }finally{await act(async()=>root.unmount());await offlineRecipes.clear();}
});
