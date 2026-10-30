import React, {act} from 'react';
import {createRoot} from 'test-renderer';
import {expect,it,vi} from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const values=vi.hoisted(()=>new Map<string,string>());
const files=vi.hoisted(()=>new Set<string>());
vi.mock('@react-native-async-storage/async-storage',()=>({default:{
 getItem:async(k:string)=>values.get(k)??null,setItem:async(k:string,v:string)=>{values.set(k,v)},removeItem:async(k:string)=>{values.delete(k)},getAllKeys:async()=>[...values.keys()],multiRemove:async(ks:string[])=>{ks.forEach(k=>values.delete(k))}
}}));
vi.mock('expo-crypto',()=>({randomUUID:()=> 'unused'}));
vi.mock('expo-file-system',()=>({Paths:{document:'file:///private'},Directory:class{uri:string;constructor(...parts:string[]){this.uri=parts.join('/')+'/'}},File:class{constructor(public uri:string){} get exists(){return files.has(this.uri)} delete(){files.delete(this.uri)}}}));
vi.mock('react-native',()=>({Alert:{alert:vi.fn()},AppState:{addEventListener:()=>({remove:vi.fn()})}}));
vi.mock('expo-router',()=>({useNavigation:()=>({dispatch:vi.fn()})}));
vi.mock('expo-router/react-navigation',()=>({usePreventRemove:vi.fn()}));
import {privateRecipeDrafts as drafts} from '../lib/privateRecipeDrafts';
import {saveCaptureOrRecover} from '../lib/captureSave';
import {usePrivateRecipeDraft} from './usePrivateRecipeDraft';
let recovery:ReturnType<typeof usePrivateRecipeDraft<any>>;
function AddRecovery(){recovery=usePrivateRecipeDraft<any>('owner','recovery',null,false,()=>{});return null;}
it('R2 preserves scan A recovery and reclaims its files before allowing a different scan',async()=>{
 const root=createRoot(); const lease=drafts.lease('owner');
 const a='file:///private/private-recipe-drafts/owner/a.jpg',b='file:///private/private-recipe-drafts/owner/b.jpg';files.add(a);files.add(b);
 try{
  await act(async()=>root.render(<AddRecovery/>));
  expect(recovery.available).toBeNull();
  await drafts.write(lease,'scan',{selectedImages:[{uri:a}]});
  const route=await saveCaptureOrRecover({capture_id:'a',expected_owner_id:'owner',original_pages:[{uri:a}],extracted:{title:'A'},source_type:'photo',is_public:false},'Guam',async()=>{throw new Error('503 source page upload')});
  expect(route).toMatchObject({pathname:'/ocr-review'});
  await act(async()=>root.render(<AddRecovery/>));
  expect.soft(recovery.available,'Mounted Add must see the new recovery before another scan').not.toBeNull();
  // The production guard is `if (recoveryDraft.available) return`.
  if(!recovery.available){
   await drafts.write(lease,'scan',{selectedImages:[{uri:b}]});
   await saveCaptureOrRecover({capture_id:'b',expected_owner_id:'owner',original_pages:[{uri:b}],extracted:{title:'B'},source_type:'photo',is_public:false},'Guam',async()=>({id:'b'}));
  }
  expect.soft(await drafts.read(lease,'recovery'),'A must remain recoverable').toMatchObject({captureId:'a'});
  await act(async () => { await recovery.discard(); });
  expect(await drafts.read(lease, 'recovery')).toBeNull();
  expect(await drafts.read(lease, 'scan')).toBeNull();
  expect(files.has(a)).toBe(false);
  expect.soft(files.has(a)&&values.size===0,'No unreferenced private original should remain').toBe(false);
 }finally{await act(async()=>root.unmount())}
});
