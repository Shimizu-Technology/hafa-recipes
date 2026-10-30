import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const m = vi.hoisted(() => ({ reduced: false, timing: vi.fn() }));
vi.mock('react-native', () => {
  class Value {
    constructor(public value: number) {}
    stopAnimation() {}
    interpolate(config: unknown) { return config; }
  }
  return { Pressable: 'Pressable', View: 'View', Platform: { OS: 'ios' }, Easing: { bezier: () => 'ease-out' }, Animated: { Value, createAnimatedComponent: () => 'AnimatedPressable', timing: (_v: unknown, config: unknown) => { m.timing(config); return { start() {} }; } } };
});
vi.mock('moti', () => ({ MotiView: 'MotiView' }));
vi.mock('react-native-reanimated', () => ({ default: {}, Easing: { bezier: () => 'ease-out' } }));
vi.mock('@/hooks/useReduceMotion', () => ({ useReduceMotion: () => m.reduced }));
import { ScalePressable } from './Animated';
beforeEach(() => { m.reduced=false; m.timing.mockClear(); });

describe('shared press feedback', () => {
  it.each([false, true])('uses native-driver timing and honors Reduce Motion=%s', async (reduced) => {
    m.reduced=reduced; const r=createRoot(); const onPressIn=vi.fn(); const onPressOut=vi.fn();
    await act(async () => r.render(<ScalePressable onPressIn={onPressIn} onPressOut={onPressOut}>Press</ScalePressable>));
    const control=r.container.queryAll(n => n.type==='AnimatedPressable')[0];
    expect(control.props.style[1].transform[0].scale).toEqual(reduced ? 1 : { inputRange:[0,1], outputRange:[1,0.97] });
    expect(control.props.style[1].opacity).toEqual({ inputRange:[0,1], outputRange:[1,0.85] });
    await act(async () => { control.props.onPressIn({}); control.props.onPressOut({}); });
    expect(m.timing.mock.calls.map(([config]) => config)).toEqual([
      { toValue:1, duration:120, easing:'ease-out', useNativeDriver:true },
      { toValue:0, duration:160, easing:'ease-out', useNativeDriver:true },
    ]);
    expect(onPressIn).toHaveBeenCalledOnce(); expect(onPressOut).toHaveBeenCalledOnce();
    await act(async () => r.unmount());
  });
  it('does not animate a disabled press', async () => {
    const r=createRoot(); await act(async () => r.render(<ScalePressable disabled>Press</ScalePressable>));
    await act(async () => r.container.queryAll(n => n.type==='AnimatedPressable')[0].props.onPressIn({}));
    expect(m.timing).not.toHaveBeenCalled(); await act(async () => r.unmount());
  });
});
