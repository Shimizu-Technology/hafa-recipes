import React,{act} from 'react';
import {createRoot} from 'test-renderer';
import {expect,it,vi} from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const data=vi.hoisted(()=>new Map<string,string>());
vi.mock('@react-native-async-storage/async-storage',()=>({default:{getItem:async(k:string)=>data.get(k)??null,setItem:async(k:string,v:string)=>{data.set(k,v)},removeItem:async(k:string)=>{data.delete(k)},getAllKeys:async()=>[...data.keys()],multiRemove:async(ks:string[])=>{ks.forEach(k=>data.delete(k))}}}));
import {offlineRecipes} from '../lib/offlineRecipes';
import {privateRecipeDrafts, createPrivateRecipeDrafts} from '../lib/privateRecipeDrafts';
import {useScaledServings} from './useScaledServings';
import {stagePendingShareCapture,consumePendingShareCapture} from '../lib/shareCapture';
async function ownerA(){data.clear();await offlineRecipes.clear();await offlineRecipes.bindSubject('subject');await offlineRecipes.verify('subject','owner-a');}
it('R4 cannot consume A staged share images after stable owner B changes',async()=>{
 await ownerA();const token=stagePendingShareCapture({kind:'images',images:[{uri:'file:///owner-a/private-image.jpg',mimeType:'image/jpeg'}]});
 try{await offlineRecipes.verify('subject','owner-b');const capture=consumePendingShareCapture(token);console.log('R4 B consumed staged capture',capture);expect(capture).toBeNull();}
 finally{consumePendingShareCapture(token);await offlineRecipes.clear();}
});
it('R4 rejects A private draft lease writes after stable owner B changes',async()=>{
 await ownerA();const lease=privateRecipeDrafts.lease('owner-a');
 await offlineRecipes.verify('subject','owner-b');
 let rejected=false;try{await privateRecipeDrafts.write(lease,'manual',{title:'A private recipe after retirement'});}catch{rejected=true;}
 console.log('R4 old draft accepted',!rejected,'disk',data.get('hafa_private_recipe_draft_v1:owner-a:manual'));
 expect(rejected).toBe(true);await offlineRecipes.clear();
});

it('retires a dispatched draft write without replacing A durable recovery when A returns',async()=>{
 await ownerA();const values=new Map<string,string>();let finish!:()=>void,entered!:()=>void;
 const started=new Promise<void>(r=>{entered=r}),gate=new Promise<void>(r=>{finish=r});let pause=false;
 const store=createPrivateRecipeDrafts({getItem:async(k:string)=>values.get(k)??null,setItem:async(k:string,v:string)=>{if(pause){entered();await gate;}values.set(k,v)},removeItem:async(k:string)=>{values.delete(k)},getAllKeys:async()=>[...values.keys()],multiRemove:async(ks:string[])=>ks.forEach(k=>values.delete(k))} as any);
 const a=store.lease('owner-a');await store.write(a,'manual',{title:'A committed recovery'});pause=true;
 const pending=store.write(a,'manual',{title:'A retired write'}).catch(()=>undefined);await started;
 await offlineRecipes.verify('subject','owner-b');pause=false;finish();await pending;
 expect([...values.values()].join()).not.toContain('A retired write');
 await offlineRecipes.verify('subject','owner-a');expect(await store.read(store.lease('owner-a'),'manual')).toEqual({title:'A committed recovery'});
 await offlineRecipes.clear();
});
it('keeps unassigned staged captures under the existing explicit-claim rule',async()=>{
 await offlineRecipes.clear();await offlineRecipes.bindSubject(null);
 const token=stagePendingShareCapture({kind:'text',text:'unassigned recipe'});
 await offlineRecipes.bindSubject('subject');await offlineRecipes.verify('subject','owner-a');
 expect(consumePendingShareCapture(token)).toEqual({kind:'text',text:'unassigned recipe'});await offlineRecipes.clear();
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueueChatImageCleanup, activateChatImageCleanup, processChatImageCleanup, recoverChatImageCleanup } from '../lib/chatImageCleanup';
it('retires a dispatched chat cleanup journal write and replays it only when A returns',async()=>{
 await ownerA();const key='hafa.chat.v2.owner-a.cooking',queue=key+'.pending-image-cleanup';
 await enqueueChatImageCleanup(key,{id:'keep',imageUrls:['https://images.test/a-private.jpg']});
 let finish!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>{entered=r}),gate=new Promise<void>(r=>{finish=r});
 const original=AsyncStorage.setItem.bind(AsyncStorage);const spy=vi.spyOn(AsyncStorage,'setItem').mockImplementation(async(k,v)=>{if(k===queue){entered();await gate;}return original(k,v)});
 const pending=activateChatImageCleanup(key,'keep').catch(()=>undefined),remove=vi.fn(async()=>{});
 try{await started;await offlineRecipes.verify('subject','owner-b');finish();await pending;expect(JSON.parse(data.get(queue)!)[0].state).toBe('prepared');
 await processChatImageCleanup(key,remove);expect(remove).not.toHaveBeenCalled();
 await offlineRecipes.verify('subject','owner-a');await recoverChatImageCleanup(key,false);await processChatImageCleanup(key,remove);expect(remove).toHaveBeenCalledWith(['https://images.test/a-private.jpg']);
 }finally{finish();spy.mockRestore();await offlineRecipes.clear();}
});
