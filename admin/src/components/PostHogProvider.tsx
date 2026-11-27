import { useEffect, useLayoutEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { capturePageView, initPostHog } from '../lib/posthog'

export function PostHogProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    initPostHog()
  }, [])

  return <>{children}</>
}

export function PostHogPageView() {
  const location = useLocation()

  useEffect(() => {
    const url = new URL(
      `${location.pathname}${location.search}${location.hash}`,
      window.location.origin,
    ).toString()
    capturePageView(url)
  }, [location.pathname, location.search, location.hash])

  return null
}
