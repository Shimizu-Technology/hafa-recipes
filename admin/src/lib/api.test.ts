import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError, createAdminApi, resolveApiBaseUrl } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('resolveApiBaseUrl', () => {
  it('requires HTTPS for production', () => {
    expect(() => resolveApiBaseUrl('http://api.example.test', true)).toThrow('HTTPS')
  })

  it('removes a trailing slash without changing the origin', () => {
    expect(resolveApiBaseUrl('https://api.example.test/', true)).toBe('https://api.example.test')
  })
})

describe('createAdminApi', () => {
  it('sends the Clerk token and encoded filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const api = createAdminApi(async () => 'session-token', 'https://api.example.test')

    await api.recipes('red rice & kelaguen', 'hidden')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.test/api/admin/recipes?q=red+rice+%26+kelaguen&moderation_status=hidden')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer session-token')
  })

  it('maps a forbidden response to a bounded administrator message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Not an administrator' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))
    const api = createAdminApi(async () => 'session-token', 'https://api.example.test')

    await expect(api.dashboard()).rejects.toEqual(
      expect.objectContaining<Partial<AdminApiError>>({ status: 403, message: 'Not an administrator' }),
    )
  })

  it('does not call the API without a session token', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const api = createAdminApi(async () => null, 'https://api.example.test')

    await expect(api.dashboard()).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
