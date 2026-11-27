import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import posthog from 'posthog-js'
import { PostHogPageView } from '../components/PostHogProvider'
import {
  DEFAULT_POSTHOG_HOST,
  capturePageView,
  initPostHog,
  isPlaceholderPostHogKey,
  isPostHogInitialized,
  redactUrl,
  resetPostHogForTests,
  resolvePostHogConfig,
  sanitizePostHogEvent,
} from './posthog'

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
  },
}))

describe('admin posthog config and privacy helpers', () => {
  afterEach(() => {
    resetPostHogForTests()
    vi.clearAllMocks()
  })

  it('stays disabled when key is missing or a placeholder', () => {
    expect(isPlaceholderPostHogKey(undefined)).toBe(true)
    expect(isPlaceholderPostHogKey('phc_placeholder')).toBe(true)
    expect(isPlaceholderPostHogKey('phc_...')).toBe(true)
    expect(isPlaceholderPostHogKey('phc_realKey123456')).toBe(false)

    expect(resolvePostHogConfig({ PROD: true, VITE_PUBLIC_POSTHOG_KEY: undefined })).toBeNull()
    expect(initPostHog({ PROD: true, VITE_PUBLIC_POSTHOG_KEY: 'phc_placeholder' })).toBe(false)
    expect(posthog.init).not.toHaveBeenCalled()
    expect(isPostHogInitialized()).toBe(false)
  })

  it('only initializes in production or when VITE_ENABLE_ANALYTICS_IN_DEV is true', () => {
    expect(
      resolvePostHogConfig({
        PROD: false,
        VITE_PUBLIC_POSTHOG_KEY: 'phc_realKey123456',
      }),
    ).toBeNull()

    expect(
      resolvePostHogConfig({
        PROD: false,
        VITE_ENABLE_ANALYTICS_IN_DEV: 'true',
        VITE_PUBLIC_POSTHOG_KEY: 'phc_realKey123456',
      }),
    ).toEqual({
      apiKey: 'phc_realKey123456',
      apiHost: DEFAULT_POSTHOG_HOST,
    })

    expect(
      initPostHog({
        PROD: true,
        VITE_PUBLIC_POSTHOG_KEY: 'phc_realKey123456',
      }),
    ).toBe(true)
    expect(posthog.init).toHaveBeenCalledWith(
      'phc_realKey123456',
      expect.objectContaining({
        api_host: DEFAULT_POSTHOG_HOST,
        capture_pageview: false,
        capture_pageleave: true,
        autocapture: true,
        disable_session_recording: false,
        session_recording: { maskAllInputs: true },
      }),
    )
  })

  it('redacts sensitive query params from URLs, event properties, and SPA pageviews', () => {
    const redacted = redactUrl(
      'https://admin.hafa-recipes.com/reports?token=t1&code=c1&state=s1&auth=a1&email=op%40example.com&tab=open',
    )
    expect(redacted).toContain('token=REDACTED')
    expect(redacted).toContain('code=REDACTED')
    expect(redacted).toContain('state=REDACTED')
    expect(redacted).toContain('auth=REDACTED')
    expect(redacted).toContain('email=REDACTED')
    expect(redacted).toContain('tab=open')
    expect(redacted).not.toContain('example.com')

    const sanitized = sanitizePostHogEvent({
      uuid: 'evt-1',
      event: '$pageleave',
      properties: {
        $current_url: 'https://admin.hafa-recipes.com/audit?auth=secret',
      },
    })
    expect(sanitized?.properties?.$current_url).toBe(
      'https://admin.hafa-recipes.com/audit?auth=REDACTED',
    )

    capturePageView('https://admin.hafa-recipes.com/reports?token=secret')
    expect(posthog.capture).not.toHaveBeenCalled()

    initPostHog({
      PROD: true,
      VITE_PUBLIC_POSTHOG_KEY: 'phc_realKey123456',
    })

    render(
      <MemoryRouter initialEntries={['/reports?token=secret&filter=open']}>
        <PostHogPageView />
      </MemoryRouter>,
    )

    expect(posthog.capture).toHaveBeenCalledWith('$pageview', {
      $current_url: `${window.location.origin}/reports?token=REDACTED&filter=open`,
    })
  })
})
