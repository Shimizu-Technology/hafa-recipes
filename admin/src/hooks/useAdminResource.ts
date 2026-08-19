import { useCallback, useEffect, useState } from 'react'

interface ResourceState<T> {
  data: T | null
  error: string | null
  loading: boolean
}

export function useAdminResource<T>(loader: (signal: AbortSignal) => Promise<T>) {
  const [reloadKey, setReloadKey] = useState(0)
  const [state, setState] = useState<ResourceState<T>>({ data: null, error: null, loading: true })

  useEffect(() => {
    const controller = new AbortController()
    loader(controller.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          data: null,
          error: error instanceof Error ? error.message : 'Unable to load this admin view.',
          loading: false,
        })
      })
    return () => controller.abort()
  }, [loader, reloadKey])

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])
  return { ...state, reload }
}
