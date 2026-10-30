import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const cache = vi.hoisted(() => ({ clearMemoryCache: vi.fn(async () => true), clearDiskCache: vi.fn(async () => true) }));
vi.mock('expo-image', async () => { const React = await import('react'); return { Image: Object.assign((props: any) => React.createElement('ExpoImage', props), cache) }; });
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({ useColors: () => ({ tint: '#155c52' }) }));
vi.mock('@react-native-async-storage/async-storage', () => { const data=new Map<string,string>();return {default:{getItem:async(k:string)=>data.get(k)??null,setItem:async(k:string,v:string)=>{data.set(k,v)},getAllKeys:async()=>[...data.keys()],multiRemove:async(ks:string[])=>ks.forEach(k=>data.delete(k))}}; });
import { offlineRecipes } from '@/lib/offlineRecipes';
import { RecipeThumbnail } from './RecipeThumbnail';
it('retires a private image load and its late callbacks without persistent caching', async () => {
 await offlineRecipes.bindSubject('subject'); await offlineRecipes.verify('subject','a');
 const root=createRoot(), onError=vi.fn();
 try {
  await act(async()=>root.render(<RecipeThumbnail uri="https://images.test/private-a.jpg" style={{}} onError={onError}/>));
  const old=root.container.queryAll(n=>n.type==='ExpoImage')[0];
  expect.soft(old.props.cachePolicy).toBe('none');
  cache.clearMemoryCache.mockClear(); cache.clearDiskCache.mockClear();
  await act(async()=>{await offlineRecipes.verify('subject','b')});
  expect(cache.clearMemoryCache).toHaveBeenCalled(); expect(cache.clearDiskCache).toHaveBeenCalled();
  expect.soft(root.container.queryAll(n=>n.type==='ExpoImage')).toHaveLength(0);
  await act(async()=>old.props.onError({error:'late a'}));expect(onError).not.toHaveBeenCalled();
 } finally {await act(async()=>root.unmount());await offlineRecipes.clear();}
});
