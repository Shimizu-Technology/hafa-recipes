import { useRecipeOwnerGeneration } from './useOfflineLease';
import { useEffect, useRef, useState, useMemo } from 'react';
import { Alert, AppState } from 'react-native';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { privateRecipeDrafts, type RecipeDraftKind } from '@/lib/privateRecipeDrafts';

/** Private local recovery, with an explicit choice before replacing prior work. */
export function usePrivateRecipeDraft<T>(owner: string | null, kind: RecipeDraftKind, value: T, hasContent: boolean, restore: (value: T) => void) {
  const authority = useRecipeOwnerGeneration();
  const navigation = useNavigation();
  const [available, setAvailable] = useState<T | null>(null);
  const [loadedAuthority, setLoadedAuthority] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leaveWaiters = useRef<Array<() => void>>([]);
  const allowLeave = () => leaving ? Promise.resolve() : new Promise<void>(resolve => { leaveWaiters.current.push(resolve); setLeaving(true); });
  const lease = useMemo(() => owner ? privateRecipeDrafts.lease(owner) : null, [owner, authority]);
  const finished = useRef(false);
  const ownWrite = useRef(false);
  const receipt = useRef<T | null>(null);
  const current = useRef({ value, hasContent, owner });
  current.current = { value, hasContent, owner };
  useEffect(() => {
    let alive = true;
    setLoadedAuthority(null); setReady(false); setAvailable(null); finished.current = false;
    const refresh = () => {
      if (!lease || ownWrite.current) return;
      void privateRecipeDrafts.read(lease, kind).then(saved => {
        if (alive) { privateRecipeDrafts.assert(lease!); setLoadedAuthority(authority); receipt.current = saved; setAvailable(saved); setReady(true); }
      }).catch((e: Error) => { if (alive) setError(e.message); });
    };
    refresh();
    const unsubscribe = privateRecipeDrafts.subscribe(refresh);
    return () => { alive = false; unsubscribe(); };
  }, [owner, kind, lease]);
  useEffect(() => { if (!hasContent) { finished.current = false; setLeaving(false); } }, [hasContent]);
  const flush = async () => {
    if (!lease || lease.owner !== current.current.owner || finished.current) return;
    if (available) throw new Error('Choose Resume draft or Discard draft before replacing your saved work.');
    if (current.current.hasContent) {
      const snapshot = current.current.value;
      ownWrite.current = true;
      try { await privateRecipeDrafts.write(lease, kind, snapshot); receipt.current = snapshot; }
      finally { ownWrite.current = false; }
    }
  };
  useEffect(() => {
    if (!ready || available || !hasContent) return;
    const timer = setTimeout(() => { void flush().catch((e: Error) => setError(e.message)); }, 300);
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') void flush().catch((e: Error) => setError(e.message));
    });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [value, ready, available, hasContent]);
  usePreventRemove(!!owner && hasContent && !leaving && !finished.current, ({ data }) => {
    Alert.alert('Keep your recipe draft?', 'Drafts stay private on this device and are cleared when you sign out.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Keep draft and leave', onPress: () => { void flush().then(() => { void allowLeave().then(() => navigation.dispatch(data.action)); }).catch((e: Error) => setError(e.message)); } },
      { text: 'Discard', style: 'destructive', onPress: () => { void finish().then(() => { void allowLeave().then(() => navigation.dispatch(data.action)); }).catch((e: Error) => setError(e.message)); } },
    ]);
  });
  useEffect(() => { if (leaving) leaveWaiters.current.splice(0).forEach(resolve => resolve()); }, [leaving]);
  const finish = async () => { finished.current = true; if (lease) await privateRecipeDrafts.remove(lease, kind, receipt.current ?? current.current.value); await allowLeave(); };
  return {
    available: loadedAuthority === authority ? available : null, ready: loadedAuthority === authority && ready, error, flush, finish, hasContent,
    async leave() { finished.current = true; await allowLeave(); },
    pause() { if (lease) privateRecipeDrafts.assert(lease); setAvailable(current.current.value); },
    resume() { if (lease) privateRecipeDrafts.assert(lease); if (available) restore(available); setAvailable(null); },
    async discard() { if (lease) await privateRecipeDrafts.remove(lease, kind, receipt.current ?? current.current.value); setAvailable(null); },
  };
}
