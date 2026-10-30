import { recipeOperation, recipeScope } from './recipeQueryScope';

/** Freeze authority before an async API method can yield, refresh a token or retry. */
export function ownerScopedApi<T extends object>(target: T): T {
  return new Proxy(target, { get(object, property) {
    const method = Reflect.get(object, property);
    if (typeof method !== 'function') return method;
    if (['setAuthContext', 'setTokenGetter', 'getAuthScope', 'getCurrentUserIdentity'].includes(String(property))) return method.bind(object);
    const scope = recipeScope();
    return (...args: any[]) => {
      const operation = recipeOperation(scope);
      const callerSignals = args.filter(value => value && typeof value === 'object' && typeof value.addEventListener === 'function' && 'aborted' in value);
      for (const signal of callerSignals) { if (signal.aborted) operation.cancel(); else signal.addEventListener('abort', operation.cancel, { once: true }); }
      const release = () => { operation.release(); for (const signal of callerSignals) signal.removeEventListener('abort', operation.cancel); };
      let receiver: any;
      const transport = new Proxy((object as any).client, { get(client, key) {
        const send = Reflect.get(client, key);
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(String(key))) return typeof send === 'function' ? send.bind(client) : send;
        return (...values: any[]) => {
          operation.assert();
          const index = key === 'get' || key === 'delete' ? 1 : 2;
          const config = values[index] || {};
          const previous = config.requestGuard;
          const abort = () => operation.cancel();
          if (config.signal?.aborted) operation.cancel();
          config.signal?.addEventListener('abort', abort, { once: true });
          values[index] = { ...config, signal: operation.signal, requestGuard: () => { operation.assert(); previous?.(); } };
          return Promise.resolve(send.apply(client, values)).then(value => { operation.assert(); return value; })
            .finally(() => config.signal?.removeEventListener('abort', abort));
        };
      } });
      receiver = new Proxy(object, { get(instance, key) {
        if (key === 'client') return transport;
        if (key === 'ownerSignal') return operation.signal;
        if (key === 'recipeWriteGuard') return (extra?: () => void) => {
          const guard = (instance as any).recipeWriteGuard(extra);
          return () => { operation.assert(); guard(); };
        };
        return Reflect.get(instance, key);
      } });
      try {
        operation.assert();
        return Promise.resolve(method.apply(receiver, args)).then(value => { operation.assert(); return value; }).finally(release);
      } catch (error) { release(); return Promise.reject(error); }
    };
  } });
}
