import { describe, expect, it } from 'vitest';
import Colors from './Colors';
function luminance(hex:string) {
  const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
  return .2126*r+.7152*g+.0722*b;
}
function contrast(a:string,b:string) { const [hi,lo]=[luminance(a),luminance(b)].sort((x,y)=>y-x); return (hi+.05)/(lo+.05); }
describe.each(['light','dark'] as const)('%s neutral selections',scheme=>{
  it('keeps selected Chip and filter label/icon text readable on the neutral fill',()=>{
    expect(contrast(Colors[scheme].background,Colors[scheme].text)).toBeGreaterThanOrEqual(4.5);
  });
});
