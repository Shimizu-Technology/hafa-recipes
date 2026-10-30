import { expect, it, vi } from 'vitest';
const values=vi.hoisted(()=>new Map<string,string>());
vi.mock('@react-native-async-storage/async-storage',()=>({default:{
 getItem:async(key:string)=>values.get(key)??null,setItem:async(key:string,value:string)=>{values.set(key,value)},
 removeItem:async(key:string)=>{values.delete(key)},getAllKeys:async()=>[...values.keys()],multiRemove:async(keys:string[])=>keys.forEach(key=>values.delete(key)),
}}));
import {offlineRecipes} from './offlineRecipes';
import {recipeScope} from './recipeQueryScope';
import {writeCookModeStep,readCookModeStep,cookModeStepKey} from './cookModeProgress';
it('fences retained Cook Mode progress writes and removes A progress before B writes',async()=>{
 await offlineRecipes.bindSubject('subject');await offlineRecipes.verify('subject','a');const a=recipeScope();
 await writeCookModeStep('recipe','2',a);const oldKey=cookModeStepKey('recipe');
 await offlineRecipes.verify('subject','b');const b=recipeScope();
 await expect(writeCookModeStep('recipe','3',a)).rejects.toThrow('account');
 await expect(writeCookModeStep('recipe',null,a)).rejects.toThrow('account');
 await writeCookModeStep('recipe','1',b);
 expect(values.has(oldKey)).toBe(false);expect(cookModeStepKey('recipe')).not.toBe(oldKey);
 expect(await readCookModeStep('recipe',b)).toBe('1');
 await offlineRecipes.clear();
});
