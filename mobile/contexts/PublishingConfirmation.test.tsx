import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ back: null as null | (() => boolean), dismiss: vi.fn() }));
vi.mock('react-native', async () => {
  const React = await import('react');
  const host = (name: string) => (props: any) => React.createElement(name, props, props.children);
  return { View: host('View'), ScrollView: host('ScrollView'), Text: host('Text'), Pressable: host('Pressable'),
    Keyboard: { dismiss: mocks.dismiss }, BackHandler: { addEventListener: (_event: string, handler: () => boolean) => {
      mocks.back = handler; return { remove: () => { mocks.back = null; } };
    } } };
});
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ colorScheme: 'light' }) }));
import { CONFIRMATION_TIMEOUT_MS, PublishingConfirmationProvider, usePublishingConfirmation } from './PublishingConfirmation';
let confirm!: ReturnType<typeof usePublishingConfirmation>;
let tree: ReactTestRenderer;
function Harness() { confirm = usePublishingConfirmation(); return <>{'screen contents'}</>; }
beforeEach(async () => { vi.useFakeTimers(); await act(async () => { tree = create(<PublishingConfirmationProvider><Harness /></PublishingConfirmationProvider>); }); });
afterEach(async () => { await act(async () => tree.unmount()); vi.useRealTimers(); });
describe('screen-local publishing confirmation', () => {
  it('renders an in-screen overlay and resolves the public choice', async () => {
    let result!: Promise<boolean>;
    await act(async () => { result = confirm({ message: 'Rice', label: 'Make public' }); });
    expect(tree.root.findAll(node => node.type === ('View' as any) && node.props.testID === 'publishing-confirmation')).toHaveLength(1);
    expect(mocks.dismiss).toHaveBeenCalled();
    await act(async () => tree.root.findAllByType('Pressable' as any)[0].props.onPress());
    expect(await result).toBe(true);
  });
  it('treats Android back as Keep private', async () => {
    let result!: Promise<boolean>;
    await act(async () => { result = confirm({ message: '', label: 'Make public' }); });
    await act(async () => { expect(mocks.back!()).toBe(true); });
    expect(await result).toBe(false);
    expect(tree.root.findAll(node => node.type === ('View' as any) && node.props.testID === 'publishing-confirmation')).toHaveLength(0);
  });
  it('rejects an unattended prompt so Save can recover without publishing', async () => {
    let result!: Promise<string>;
    await act(async () => { result = confirm({ message: '', label: 'Make public' }).then(String, error => error.message); });
    await act(async () => { await vi.advanceTimersByTimeAsync(CONFIRMATION_TIMEOUT_MS); });
    expect(await result).toContain('timed out');
    expect(tree.root.findAll(node => node.type === ('View' as any) && node.props.testID === 'publishing-confirmation')).toHaveLength(0);
  });
  it('settles pending work when the screen unmounts', async () => {
    let result!: Promise<string>;
    await act(async () => { result = confirm({ message: '', label: 'Make public' }).then(String, error => error.message); });
    await act(async () => tree.unmount());
    expect(await result).toContain('screen closed');
    expect(vi.getTimerCount()).toBe(0);
  });
});
